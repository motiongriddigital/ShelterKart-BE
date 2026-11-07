#!/bin/sh
# The sandbox's network guardrail. The application container shares THIS container's network namespace and has no NET_ADMIN, so it cannot
# change these rules. Default: nothing leaves. Allowed out: the sandbox's own network (database, stand-in AI server), DNS, and TCP 443 to
# the addresses of the allowed hosts only. Bytes coming back from them are capped by a quota, and new connections are rate-limited.
set -eu
ALLOW_HOSTS="${ALLOW_HOSTS:-}"
SANDBOX_SUBNET="${SANDBOX_SUBNET:?}"
QUOTA_BYTES="${QUOTA_BYTES:-314572800}"        # inbound bytes from allowed hosts, in total (default 300 MB)
NEW_CONN_PER_MIN="${NEW_CONN_PER_MIN:-120}"    # new connections per minute, per destination address

iptables -F; iptables -X
iptables -P OUTPUT DROP; iptables -P INPUT DROP; iptables -P FORWARD DROP
ip6tables -P OUTPUT DROP; ip6tables -P INPUT DROP; ip6tables -P FORWARD DROP

iptables -A OUTPUT -o lo -j ACCEPT;  iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -d "$SANDBOX_SUBNET" -j ACCEPT; iptables -A INPUT -s "$SANDBOX_SUBNET" -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT; iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT;  iptables -A INPUT -p tcp --sport 53 -j ACCEPT

ADDED=" "
allow_ip() {
  case "$ADDED" in *" $1 "*) return 0;; esac
  iptables -A OUTPUT -d "$1" -p tcp --dport 443 -m hashlimit --hashlimit-name "c$(echo "$1" | tr . _)" --hashlimit-mode dstip --hashlimit-upto "${NEW_CONN_PER_MIN}/min" --hashlimit-burst 20 -m conntrack --ctstate NEW -j ACCEPT
  iptables -A OUTPUT -d "$1" -p tcp --dport 443 -m conntrack --ctstate ESTABLISHED -j ACCEPT
  iptables -A INPUT -s "$1" -p tcp --sport 443 -m quota --quota "$QUOTA_BYTES" -j ACCEPT
  ADDED="$ADDED$1 "
}
resolve() { for h in $(echo "$ALLOW_HOSTS" | tr ',' ' '); do dig +short +time=3 +tries=2 A "$h" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true; done | sort -u; }

# The refusing rules go last, so their counters show what the application tried and was not allowed to do.
finish() { iptables -D OUTPUT -j REJECT 2>/dev/null || true; iptables -A OUTPUT -p tcp -j REJECT --reject-with tcp-reset; iptables -A OUTPUT -j REJECT; }

for ip in $(resolve); do allow_ip "$ip"; done
finish
echo "ready: allowed hosts [$ALLOW_HOSTS], quota ${QUOTA_BYTES} bytes, ${NEW_CONN_PER_MIN} new connections/min"
touch /tmp/ready
while true; do
  sleep 30
  for ip in $(resolve); do
    case "$ADDED" in *" $ip "*) ;; *) iptables -D OUTPUT -p tcp -j REJECT --reject-with tcp-reset; iptables -D OUTPUT -j REJECT; allow_ip "$ip"; finish; echo "added $ip";; esac
  done
done
