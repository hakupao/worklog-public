# Binaries go to <repo>/bin/ so the exe-dir-ancestor lookup finds the repo's config.toml (spec §7).
VERSION ?= $(shell git describe --tags --match 'wl-v*' --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/hakupao/worklog/collector/internal/cli.Version=$(VERSION)
BIN := ../bin

export CGO_ENABLED := 0

.PHONY: build build-windows test vet

build:
	go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN)/wl ./cmd/wl

build-windows:
	GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN)/wl-windows-amd64.exe ./cmd/wl

test:
	go test ./...

vet:
	go vet ./...
