.PHONY: build test clean install-web build-contracts

# Build all contracts
build-contracts:
	cd contracts/vault && soroban contract build

# Test all contracts
test:
	cargo test --workspace

# Build all Rust code
build:
	cargo build --workspace --release

# Install frontend dependencies
install-web:
	cd web && npm install

# Run frontend dev server
dev-web:
	cd web && npm run dev

# Clean build artifacts
clean:
	cargo clean
	cd web && rm -rf .next node_modules
	find . -name "*.wasm" -delete
	find . -name "*.wasm.hash" -delete







