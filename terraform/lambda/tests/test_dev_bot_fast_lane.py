"""dev-bot's fast lane routing (docs/DEV_WORKER.md, "Fast lane") with stubbed AWS and Telegram clients.

Run: python3 -m unittest discover -s terraform/lambda/tests
"""

import importlib
import json
import os
import sys
import types
import unittest
from unittest import mock

LAMBDA_DIR = os.path.join(os.path.dirname(__file__), "..")


def load_dev_bot(fast_lane=True):
    """Import dev_bot with stub clients (no AWS) and the fast lane configured or not."""
    clients = {}

    def client(name, **_kwargs):
        clients.setdefault(name, mock.MagicMock(name=name))
        return clients[name]

    sys.modules["boto3"] = types.SimpleNamespace(client=client)
    env = {
        "CLUSTER_ARN": "cluster",
        "TASK_DEFINITION_ARN": "task",
        "SUBNET_IDS": "subnet",
        "SECURITY_GROUP_IDS": "sg",
        "QUEUE_URL": "worker-queue",
        "STATE_BUCKET": "bucket",
        "ONCALL_SECRET_ARN": "oncall",
        "DEV_SECRET_ARN": "dev",
        "FAST_LANE_FUNCTION": "fast-lane" if fast_lane else "",
        "FAST_LANE_QUEUE_URL": "fast-lane-queue" if fast_lane else "",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        sys.path.insert(0, LAMBDA_DIR)
        try:
            sys.modules.pop("dev_bot", None)
            module = importlib.import_module("dev_bot")
        finally:
            sys.path.remove(LAMBDA_DIR)
    module.say = mock.MagicMock(name="say")
    module.bot_api = mock.MagicMock(name="bot_api")
    return module, clients


MESSAGE = {"message_id": 7, "date": 1000, "chat": {"id": 42}, "text": "привіт"}


class FastLaneRouting(unittest.TestCase):
    def test_message_goes_to_the_fast_lane_when_the_worker_is_not_running(self):
        bot, clients = load_dev_bot()
        bot.worker_tasks = mock.MagicMock(return_value=[])
        bot.forward(MESSAGE, "привіт", [])
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "fast-lane-queue")
        self.assertEqual(json.loads(sent["MessageBody"])["text"], "привіт")
        clients["lambda"].invoke.assert_called_once()
        self.assertEqual(clients["lambda"].invoke.call_args.kwargs["InvocationType"], "Event")
        clients["ecs"].run_task.assert_not_called()
        bot.say.assert_not_called()

    def test_message_goes_to_the_running_worker(self):
        bot, clients = load_dev_bot()
        bot.worker_tasks = mock.MagicMock(return_value=[{"lastStatus": "RUNNING", "arn": "t"}])
        bot.forward(MESSAGE, "привіт", [])
        self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")
        clients["lambda"].invoke.assert_not_called()

    def test_without_the_fast_lane_the_worker_starts_as_before(self):
        bot, clients = load_dev_bot(fast_lane=False)
        bot.worker_tasks = mock.MagicMock(return_value=[])
        bot.worker_stopping = mock.MagicMock(return_value=False)
        clients["ecs"].run_task.return_value = {"tasks": [{"taskArn": "t"}], "failures": []}
        bot.forward(MESSAGE, "привіт", [])
        clients["ecs"].run_task.assert_called_once()
        self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")

    def test_fast_lane_buttons_go_to_the_fast_lane(self):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        query = {"id": "q1", "data": "f|ask|abc|0", "message": {"message_id": 9, "chat": {"id": 42}}}
        bot.callback(query)
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "fast-lane-queue")
        self.assertEqual(json.loads(sent["MessageBody"])["callback"]["data"], "f|ask|abc|0")

    def test_hand_over_puts_the_task_into_the_worker_queue_and_starts_it(self):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        bot.worker_tasks = mock.MagicMock(return_value=[])
        bot.worker_stopping = mock.MagicMock(return_value=False)
        clients["ecs"].run_task.return_value = {"tasks": [{"taskArn": "t"}], "failures": []}
        event = {"action": "hand_over", "reason": "PR", "since": 1000, "message": {"text": "do it", "attachments": []}}
        result = bot.handler(event, None)
        self.assertEqual(result, {"handed_over": True, "started": True})
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "worker-queue")
        body = json.loads(sent["MessageBody"])
        self.assertEqual((body["text"], body["handover"], body["date"]), ("do it", True, 1000))
        overrides = clients["ecs"].run_task.call_args.kwargs["overrides"]["containerOverrides"][0]
        self.assertEqual(overrides["environment"], [{"name": "UP_AT", "value": "1000"}])

    def test_hand_over_to_a_running_worker_only_queues(self):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        bot.worker_tasks = mock.MagicMock(return_value=[{"lastStatus": "RUNNING", "arn": "t"}])
        result = bot.handler({"action": "hand_over", "since": 1000, "message": {"text": "x"}}, None)
        self.assertEqual(result, {"handed_over": True, "running": True})
        clients["ecs"].run_task.assert_not_called()
        clients["sqs"].send_message.assert_called_once()

    def test_an_empty_hand_over_is_refused(self):
        bot, clients = load_dev_bot()
        self.assertEqual(bot.handler({"action": "hand_over", "message": {}}, None)["handed_over"], False)
        clients["sqs"].send_message.assert_not_called()

    def test_a_webhook_event_cannot_hand_over(self):
        bot, _clients = load_dev_bot()
        bot.telegram_update = mock.MagicMock(return_value={"statusCode": 200})
        bot.hand_over = mock.MagicMock()
        bot.handler({"action": "hand_over", "requestContext": {"http": {}}, "body": "{}"}, None)
        bot.hand_over.assert_not_called()


if __name__ == "__main__":
    unittest.main()
