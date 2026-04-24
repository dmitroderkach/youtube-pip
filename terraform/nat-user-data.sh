#!/bin/bash
# NAT on Amazon Linux 2023 (single ENI). Plain shell file (loaded via Terraform file()) so $5 / $(...) are not mangled by HCL.
# Ref: https://docs.aws.amazon.com/vpc/latest/userguide/work-with-nat-instances.html
set -eux
for _ in {1..12}; do
  dnf install -y iptables-services && break
  sleep 10
done
systemctl enable iptables
systemctl start iptables
echo "net.ipv4.ip_forward=1" >/etc/sysctl.d/99-nat-ip-forward.conf
sysctl -p /etc/sysctl.d/99-nat-ip-forward.conf
IFACE=""
for _ in {1..120}; do
  IFACE="$(ip -4 route show default 2>/dev/null | awk '/^default/ {print $5; exit}')"
  if [ -n "$IFACE" ] && [ -d "/sys/class/net/$IFACE" ]; then break; fi
  sleep 1
done
test -n "$IFACE"
test -d "/sys/class/net/$IFACE"
/sbin/iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
/sbin/iptables -F FORWARD
service iptables save
