FROM rust:1.98-alpine AS build

RUN apk add --no-cache build-base

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM scratch

COPY --from=build /app/target/release/webrtc-service /webrtc-service

ENV BIND_ADDR=0.0.0.0:9001
EXPOSE 9001

ENTRYPOINT ["/webrtc-service"]
