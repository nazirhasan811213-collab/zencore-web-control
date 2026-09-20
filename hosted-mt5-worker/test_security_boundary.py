import base64
import json
import unittest

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import security_boundary as boundary


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


class TestUnwrapper:
    def __init__(self, private_key):
        self.private_key = private_key

    def unwrap_rsa_oaep_sha256(self, _key_id: str, wrapped_key: bytes) -> bytes:
        return self.private_key.decrypt(
            wrapped_key,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )


def encrypted_envelope(payload: dict, key_id: str = "demo-key-v1"):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    aes_key = AESGCM.generate_key(bit_length=256)
    iv = bytes(range(12))
    ciphertext = AESGCM(aes_key).encrypt(
        iv,
        json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        None,
    )
    wrapped_key = private_key.public_key().encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "version": 1,
        "algorithm": boundary.ENVELOPE_ALGORITHM,
        "keyId": key_id,
        "wrappedKey": b64url(wrapped_key),
        "iv": b64url(iv),
        "ciphertext": b64url(ciphertext),
    }, TestUnwrapper(private_key)


class HostedCredentialBoundaryTests(unittest.TestCase):
    def test_browser_compatible_envelope_decrypts_only_through_external_unwrapper(self):
        envelope, unwrapper = encrypted_envelope({
            "login": "12345678",
            "password": "demo-secret",
            "server": "AnyBroker-Demo",
            "tradeMode": "DEMO",
            "createdAt": 1790000000000,
        })
        credential = boundary.decrypt_credential_envelope(envelope, "demo-key-v1", unwrapper)
        self.assertEqual(credential.text(), ("12345678", "demo-secret", "AnyBroker-Demo"))
        credential.wipe()
        self.assertEqual(set(credential.password), {0})

    def test_wrong_key_id_and_ciphertext_tampering_fail_closed(self):
        envelope, unwrapper = encrypted_envelope({
            "login": "12345678", "password": "demo-secret",
            "server": "AnyBroker-Demo", "tradeMode": "DEMO",
            "createdAt": 1790000000000,
        })
        with self.assertRaisesRegex(RuntimeError, "key id"):
            boundary.decrypt_credential_envelope(envelope, "different-key", unwrapper)
        damaged = {**envelope, "ciphertext": envelope["ciphertext"][:-2] + "AA"}
        with self.assertRaises(Exception):
            boundary.decrypt_credential_envelope(damaged, "demo-key-v1", unwrapper)

    def test_real_account_and_environment_secrets_are_rejected(self):
        envelope, unwrapper = encrypted_envelope({
            "login": "12345678", "password": "demo-secret",
            "server": "AnyBroker-Live", "tradeMode": "REAL",
            "createdAt": 1790000000000,
        })
        with self.assertRaisesRegex(RuntimeError, "DEMO"):
            boundary.decrypt_credential_envelope(envelope, "demo-key-v1", unwrapper)
        with self.assertRaisesRegex(RuntimeError, "forbidden"):
            boundary.assert_clean_worker_environment({"MT5_PASSWORD": "never-here"})


class AnalysisParityTests(unittest.TestCase):
    def payload(self):
        snapshot = {
            "contractVersion": boundary.CONTRACT_VERSION,
            "decision": "ENTRY_AUTHORIZED",
            "decisionOwner": "ZENCORE_ANALYSIS",
            "strategy": boundary.STRATEGY,
            "schemaVersion": boundary.SCHEMA_VERSION,
            "symbol": "GBPJPY",
            "side": "SELL",
            "entry": 200.0,
            "sl": 201.0,
            "tp1": 199.0,
            "tp2": 198.0,
            "tp3": 197.0,
            "sourceReceivedAt": 1790000010000,
        }
        return {
            "analysisContractVersion": boundary.CONTRACT_VERSION,
            "analysisSnapshot": snapshot,
            "strategy": boundary.STRATEGY,
            "schemaVersion": boundary.SCHEMA_VERSION,
            "symbol": "GBPJPY",
            "side": "SELL",
            "entry": 200.0,
            "sl": 201.0,
            "tp1": 199.0,
            "tp2": 198.0,
            "tp3": 197.0,
            "lotPerLayer": 0.01,
            "layers": 3,
            "totalLot": 0.03,
            "signalReceivedAt": 1790000010000,
        }

    def test_all_11_markets_are_declared_and_demo_execution_build_is_explicitly_unlocked(self):
        self.assertEqual(len(boundary.SUPPORTED_MARKETS), 11)
        self.assertTrue(boundary.HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED)
        snapshot = boundary.validate_entry_command(self.payload())
        self.assertEqual(snapshot["decisionOwner"], "ZENCORE_ANALYSIS")

    def test_flattened_payload_cannot_override_analysis_snapshot(self):
        payload = self.payload()
        payload["sl"] = 202.0
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            boundary.validate_entry_command(payload)


if __name__ == "__main__":
    unittest.main()

