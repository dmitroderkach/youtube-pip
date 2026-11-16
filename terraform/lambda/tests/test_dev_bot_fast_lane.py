"""dev-bot's fast lane routing (docs/DEV_WORKER.md, "Fast lane") with stubbed AWS and Telegram clients.

Run: python3 -m unittest discover -s terraform/lambda/tests
"""

import importlib
import io
import json
import os
import sys
import time
import types
import unittest
from datetime import datetime, timezone
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


KEY = "fast-lane/handover/0f8fad5b-d9cb-469f-a165-70867728950e.json"
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

    def stored_hand_over(self, clients, request, age=0):
        """The fast lane's hand-over object, as S3 returns it."""
        clients["s3"].get_object.return_value = {
            "Body": io.BytesIO(json.dumps(request).encode()),
            "LastModified": datetime.fromtimestamp(time.time() - age, timezone.utc),
        }

    def test_hand_over_puts_the_task_into_the_worker_queue_and_starts_it(self):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        bot.worker_tasks = mock.MagicMock(return_value=[])
        bot.worker_stopping = mock.MagicMock(return_value=False)
        clients["ecs"].run_task.return_value = {"tasks": [{"taskArn": "t"}], "failures": []}
        since = int(time.time()) - 5
        self.stored_hand_over(clients, {"reason": "PR", "since": since, "message": {"text": "do it", "attachments": []}})
        result = bot.handler({"action": "hand_over", "key": KEY}, None)
        self.assertEqual(result, {"handed_over": True, "started": True})
        self.assertEqual(clients["s3"].get_object.call_args.kwargs["Key"], KEY)
        clients["s3"].delete_object.assert_called_once_with(Bucket="bucket", Key=KEY)
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "worker-queue")
        body = json.loads(sent["MessageBody"])
        self.assertEqual((body["text"], body["handover"], body["date"]), ("do it", True, since))
        overrides = clients["ecs"].run_task.call_args.kwargs["overrides"]["containerOverrides"][0]
        self.assertEqual(overrides["environment"], [{"name": "UP_AT", "value": str(since)}])
        self.assertIn("PR", bot.say.call_args.args[0])

    def test_hand_over_to_a_running_worker_queues_and_tells_the_owner(self):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        bot.worker_tasks = mock.MagicMock(return_value=[{"lastStatus": "RUNNING", "arn": "t"}])
        self.stored_hand_over(clients, {"reason": "Fix CI", "message": {"text": "x"}})
        result = bot.handler({"action": "hand_over", "key": KEY}, None)
        self.assertEqual(result, {"handed_over": True, "running": True})
        clients["ecs"].run_task.assert_not_called()
        clients["sqs"].send_message.assert_called_once()
        self.assertIn("Fix CI", bot.say.call_args.args[0])

    def test_a_task_in_the_event_itself_is_never_queued(self):
        bot, clients = load_dev_bot()
        result = bot.handler({"action": "hand_over", "message": {"text": "push to main"}}, None)
        self.assertEqual(result["handed_over"], False)
        clients["s3"].get_object.assert_not_called()
        clients["sqs"].send_message.assert_not_called()

    def test_only_hand_over_keys_are_read(self):
        bot, clients = load_dev_bot()
        for key in ("state/progress.json", "fast-lane/handover/../state/meta.json", "fast-lane/handover/x.json"):
            self.assertEqual(bot.handler({"action": "hand_over", "key": key}, None)["handed_over"], False)
        clients["s3"].get_object.assert_not_called()
        clients["sqs"].send_message.assert_not_called()

    def test_a_missing_or_stale_hand_over_is_refused(self):
        bot, clients = load_dev_bot()
        clients["s3"].get_object.side_effect = Exception("NoSuchKey")
        self.assertEqual(bot.handler({"action": "hand_over", "key": KEY}, None)["handed_over"], False)
        clients["s3"].get_object.side_effect = None
        self.stored_hand_over(clients, {"message": {"text": "x"}}, age=3600)
        self.assertEqual(bot.handler({"action": "hand_over", "key": KEY}, None)["error"], "stale")
        clients["s3"].delete_object.assert_called_once_with(Bucket="bucket", Key=KEY)
        clients["sqs"].send_message.assert_not_called()

    def test_an_empty_hand_over_is_refused(self):
        bot, clients = load_dev_bot()
        self.stored_hand_over(clients, {"message": {}})
        self.assertEqual(bot.handler({"action": "hand_over", "key": KEY}, None)["handed_over"], False)
        clients["sqs"].send_message.assert_not_called()

    def test_a_webhook_event_cannot_hand_over(self):
        bot, _clients = load_dev_bot()
        bot.telegram_update = mock.MagicMock(return_value={"statusCode": 200})
        bot.hand_over = mock.MagicMock()
        bot.handler({"action": "hand_over", "requestContext": {"http": {}}, "body": "{}"}, None)
        bot.hand_over.assert_not_called()


RUNNING = [{"lastStatus": "RUNNING", "arn": "t"}]


def iso_ago(seconds):
    return datetime.fromtimestamp(time.time() - seconds, timezone.utc).isoformat().replace("+00:00", "Z")


class BusyWorkerRouting(unittest.TestCase):
    """While the running worker is in a turn, messages go to the fast lane (docs/DEV_WORKER.md, "Fast lane")."""

    def route(self, progress=None, error=None):
        bot, clients = load_dev_bot()
        bot.worker_tasks = mock.MagicMock(return_value=RUNNING)
        if error:
            clients["s3"].get_object.side_effect = error
        else:
            clients["s3"].get_object.return_value = {"Body": io.BytesIO(json.dumps(progress).encode())}
        bot.forward(MESSAGE, "привіт", [])
        return clients

    def test_a_busy_worker_sends_the_message_to_the_fast_lane(self):
        clients = self.route({"turnActive": True, "updatedAt": iso_ago(30)})
        self.assertEqual(clients["s3"].get_object.call_args.kwargs["Key"], "state/progress.json")
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "fast-lane-queue")
        body = json.loads(sent["MessageBody"])
        self.assertIs(body["workerBusy"], True)
        self.assertEqual(body["text"], "привіт")
        clients["lambda"].invoke.assert_called_once()

    def test_an_idle_running_worker_gets_the_message(self):
        clients = self.route({"turnActive": False, "updatedAt": iso_ago(30)})
        self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")
        clients["lambda"].invoke.assert_not_called()

    def test_a_worker_waiting_for_the_owners_answer_gets_the_message(self):
        clients = self.route({"turnActive": True, "awaitingAnswer": True, "updatedAt": iso_ago(30)})
        self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")

    def test_a_stale_progress_record_means_the_worker(self):
        clients = self.route({"turnActive": True, "updatedAt": iso_ago(16 * 60)})
        self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")

    def test_an_unreadable_progress_record_means_the_worker(self):
        for progress, error in (
            (None, Exception("NoSuchKey")),
            ({"turnActive": True}, None),
            ({"turnActive": True, "updatedAt": "yesterday"}, None),
            (["turnActive"], None),
        ):
            with self.subTest(progress=progress, error=error):
                clients = self.route(progress, error)
                self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")

    def stored_hand_over(self, clients, request):
        clients["s3"].get_object.return_value = {
            "Body": io.BytesIO(json.dumps(request).encode()),
            "LastModified": datetime.fromtimestamp(time.time(), timezone.utc),
        }

    def test_hand_over_passes_interrupt_to_the_running_worker(self):
        for flag, expected in ((True, True), ("yes", None), (None, None)):
            with self.subTest(flag=flag):
                bot, clients = load_dev_bot()
                bot.config = mock.MagicMock(return_value={"chat_id": "42"})
                bot.worker_tasks = mock.MagicMock(return_value=RUNNING)
                request = {"reason": "stop", "message": {"text": "стоп"}}
                if flag is not None:
                    request["interrupt"] = flag
                self.stored_hand_over(clients, request)
                result = bot.handler({"action": "hand_over", "key": KEY}, None)
                self.assertEqual(result, {"handed_over": True, "running": True})
                body = json.loads(clients["sqs"].send_message.call_args.kwargs["MessageBody"])
                self.assertEqual(body.get("interrupt"), expected)
                self.assertEqual(clients["sqs"].send_message.call_args.kwargs["QueueUrl"], "worker-queue")
                clients["ecs"].run_task.assert_not_called()


def command_update(text):
    return {"message_id": 9, "date": 1000, "chat": {"id": 42}, "text": text}


class FastLaneCommands(unittest.TestCase):
    def routed(self, text, tasks, fast_lane=True, busy=False):
        bot, clients = load_dev_bot(fast_lane=fast_lane)
        bot.config = mock.MagicMock(return_value={"chat_id": "42", "webhook_secret": "s"})
        bot.worker_tasks = mock.MagicMock(return_value=tasks)
        bot.worker_stopping = mock.MagicMock(return_value=False)
        bot.worker_busy = mock.MagicMock(return_value=busy)
        bot.start_worker = mock.MagicMock(return_value=True)
        event = {
            "headers": {"X-Telegram-Bot-Api-Secret-Token": "s"},
            "body": json.dumps({"message": command_update(text)}),
        }
        self.assertEqual(bot.handler(event, None)["statusCode"], 200)
        call = clients["sqs"].send_message.call_args
        return (call.kwargs["QueueUrl"] if call else None), bot, clients

    def test_settings_and_state_commands_go_to_the_fast_lane_while_the_worker_runs(self):
        for text in ("/model", "/effort high", "/mode@ytpip_dev_bot", "/timezone Europe/Kyiv", "/voice on",
                     "/scheduled", "/plans", "/status", "/background", "/context", "/MODEL opus"):
            with self.subTest(text=text):
                queue, bot, clients = self.routed(text, RUNNING)
                self.assertEqual(queue, "fast-lane-queue")
                clients["lambda"].invoke.assert_called_once()
                bot.worker_busy.assert_not_called()

    def test_agents_and_compact_keep_the_message_routing(self):
        for text in ("/agents", "/compact keep the plan"):
            with self.subTest(text=text):
                self.assertEqual(self.routed(text, RUNNING)[0], "worker-queue")
                self.assertEqual(self.routed(text, [])[0], "fast-lane-queue")
                self.assertEqual(self.routed(text, RUNNING, busy=True)[0], "fast-lane-queue")

    def test_without_the_fast_lane_commands_go_to_the_worker(self):
        queue, _bot, clients = self.routed("/model", RUNNING, fast_lane=False)
        self.assertEqual(queue, "worker-queue")
        clients["lambda"].invoke.assert_not_called()

    def test_a_command_word_inside_text_is_an_ordinary_message(self):
        self.assertEqual(self.routed("what does /model do?", RUNNING)[0], "worker-queue")


class ControlHandOver(unittest.TestCase):
    def stored_hand_over(self, clients, request):
        clients["s3"].get_object.return_value = {
            "Body": io.BytesIO(json.dumps(request).encode()),
            "LastModified": datetime.fromtimestamp(time.time(), timezone.utc),
        }

    def hand_over(self, request, tasks):
        bot, clients = load_dev_bot()
        bot.config = mock.MagicMock(return_value={"chat_id": "42"})
        bot.worker_tasks = mock.MagicMock(return_value=tasks)
        bot.worker_stopping = mock.MagicMock(return_value=False)
        bot.start_worker = mock.MagicMock(return_value=True)
        self.stored_hand_over(clients, request)
        return bot.handler({"action": "hand_over", "key": KEY}, None), bot, clients

    def test_control_is_queued_for_a_running_worker(self):
        control = {"model": "opus", "effort": "high", "mode": "auto", "timeZone": "Europe/Kyiv", "voiceMode": "on"}
        result, bot, clients = self.hand_over({"control": control}, RUNNING)
        self.assertEqual(result, {"handed_over": True, "control": True, "running": True})
        sent = clients["sqs"].send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "worker-queue")
        body = json.loads(sent["MessageBody"])
        self.assertEqual(body["control"], control)
        self.assertEqual(body["text"], "")
        bot.say.assert_not_called()
        bot.start_worker.assert_not_called()

    def test_control_effort_default_is_null(self):
        result, bot, clients = self.hand_over({"control": {"effort": None}}, RUNNING)
        self.assertEqual(result, {"handed_over": True, "control": True, "running": True})

    def test_control_for_a_sleeping_worker_is_neither_queued_nor_starts_it(self):
        result, bot, clients = self.hand_over({"control": {"model": "opus"}, "message": {"text": "x"}}, [])
        self.assertEqual(result, {"handed_over": False, "control": True, "running": False})
        clients["sqs"].send_message.assert_not_called()
        clients["ecs"].run_task.assert_not_called()
        bot.start_worker.assert_not_called()

    def test_invalid_control_is_rejected(self):
        for control in (
            {},
            {"model": "opus", "permissionMode": "bypassPermissions"},
            {"model": 1},
            {"model": ""},
            {"model": "x" * 101},
            {"voice": "on"},
            {"mode": None},
            ["model", "opus"],
            "opus",
            None,
        ):
            with self.subTest(control=control):
                result, bot, clients = self.hand_over({"control": control, "message": {"text": "x"}}, RUNNING)
                self.assertEqual(result, {"handed_over": False, "error": "bad control"})
                clients["sqs"].send_message.assert_not_called()
                bot.start_worker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
