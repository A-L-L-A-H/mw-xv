FROM golang:1.27-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git gcc musl-dev

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
COPY ui ./ui

RUN go build -o control-plane .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/control-plane .

EXPOSE 3003

ENTRYPOINT ["./control-plane"]