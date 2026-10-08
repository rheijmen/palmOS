# Agendus sync server: PocketBase with the Agendus collection built in.
FROM alpine:3.22

ARG PB_VERSION=0.40.5
# Filled in by Docker: amd64 on most servers, arm64 on ARM servers.
ARG TARGETARCH

RUN apk add --no-cache ca-certificates unzip
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip pocketbase -d /pb && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations

WORKDIR /pb
EXPOSE 80 443
ENTRYPOINT ["/pb/pocketbase", "serve", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations"]
