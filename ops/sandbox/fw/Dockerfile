FROM alpine:3.20
RUN apk add --no-cache iptables ip6tables bind-tools iproute2
COPY rules.sh report.sh /
RUN chmod +x /rules.sh /report.sh
CMD ["/rules.sh"]
