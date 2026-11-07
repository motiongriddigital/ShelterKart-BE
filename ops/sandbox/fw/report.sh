#!/bin/sh
# What crossed the boundary: per-address bytes and packets, and how much the firewall refused.
echo "--- OUTPUT (what the application sent) ---"
iptables -L OUTPUT -v -n -x | awk 'NR>2 && ($1+0>0) {print}'
echo "--- INPUT (what came back from allowed hosts, quota-capped) ---"
iptables -L INPUT -v -n -x | awk 'NR>2 && ($1+0>0) {print}'
