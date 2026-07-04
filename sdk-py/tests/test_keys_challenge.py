"""Challenge-transaction construction (no network).

The gateway only accepts a base64 signed-tx XDR whose op[0] is a
manageData carrying the challenge bytes, with a signature verifying
against tx.hash() — mirror of api/src/services/walletAuth.ts.
"""

import os

from stellar_sdk import DecoratedSignature, Keypair, TransactionEnvelope
from stellar_sdk.operation import ManageData

from noether_sdk.sub.keys import (
    CHALLENGE_DATA_NAME,
    TESTNET_PASSPHRASE,
    build_challenge_tx,
)


def test_challenge_tx_shape() -> None:
    kp = Keypair.random()
    challenge_hex = os.urandom(32).hex()

    tx = build_challenge_tx(kp.public_key, challenge_hex)

    ops = tx.transaction.operations
    assert len(ops) == 1
    op = ops[0]
    assert isinstance(op, ManageData)
    assert op.data_name == CHALLENGE_DATA_NAME
    assert op.data_value == bytes.fromhex(challenge_hex)
    assert op.source is not None and op.source.account_id == kp.public_key
    assert tx.transaction.fee == 0
    assert tx.network_passphrase == TESTNET_PASSPHRASE


def test_signed_challenge_tx_verifies_like_the_gateway() -> None:
    kp = Keypair.random()
    challenge_hex = os.urandom(32).hex()

    # Same steps keys.create performs after the signer returns.
    tx = build_challenge_tx(kp.public_key, challenge_hex)
    raw_sig = kp.sign(tx.hash())
    hint = Keypair.from_public_key(kp.public_key).signature_hint()
    tx.signatures.append(DecoratedSignature(hint, raw_sig))
    proof = tx.to_xdr()

    # Gateway-side verification path (walletAuth.verify):
    parsed = TransactionEnvelope.from_xdr(proof, TESTNET_PASSPHRASE)
    op = parsed.transaction.operations[0]
    assert isinstance(op, ManageData)
    assert op.data_value == bytes.fromhex(challenge_hex)

    verifier = Keypair.from_public_key(kp.public_key)
    assert any(
        _verifies(verifier, parsed.hash(), ds.signature) for ds in parsed.signatures
    )


def test_wrong_signer_does_not_verify() -> None:
    kp = Keypair.random()
    challenge_hex = os.urandom(32).hex()
    tx = build_challenge_tx(kp.public_key, challenge_hex)

    intruder = Keypair.random()
    raw_sig = intruder.sign(tx.hash())
    hint = Keypair.from_public_key(kp.public_key).signature_hint()
    tx.signatures.append(DecoratedSignature(hint, raw_sig))

    parsed = TransactionEnvelope.from_xdr(tx.to_xdr(), TESTNET_PASSPHRASE)
    verifier = Keypair.from_public_key(kp.public_key)
    assert not any(
        _verifies(verifier, parsed.hash(), ds.signature) for ds in parsed.signatures
    )


def _verifies(verifier: Keypair, data: bytes, signature: bytes) -> bool:
    try:
        verifier.verify(data, signature)
        return True
    except Exception:
        return False
