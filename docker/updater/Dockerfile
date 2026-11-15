# OmniCore updater helper (COMPOSE_PROFILES=…,updater). Only tools; the script it runs lives in the
# mounted checkout (docker/updater/updater.sh), so an update also updates the helper.
FROM alpine:3.20
RUN apk add --no-cache bash git curl openssh-client docker-cli docker-cli-compose setpriv coreutils sed grep
CMD ["bash", "/repo/docker/updater/updater.sh"]
