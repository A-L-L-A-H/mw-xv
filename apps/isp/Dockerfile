# Build stage
FROM rust:1.89-slim AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY apps/isp/Cargo.toml apps/isp/Cargo.lock ./
COPY apps/isp/src ./src
COPY apps/isp/migrations ./migrations

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/moonwitness-isp .
COPY apps/isp/migrations ./migrations

EXPOSE 1812/udp 1813/udp 3000

ENTRYPOINT ["./moonwitness-isp"]