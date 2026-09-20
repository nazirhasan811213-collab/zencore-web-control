import base64
import json
import unittest

from gcp_kms_unwrapper import (
    GcpKmsUnwrapper,
    GcpMetadataTokenProvider,
    KMS_API_ORIGIN,
    METADATA_TOKEN_URL,
    crc32c,
)


KEY_ALIAS = "zencore-gcp-hsm-demo-v1"
KEY_RESOURCE = (
    "projects/zencore-demo-12345/locations/asia-southeast1/"
    "keyRings/zencore-mt5/cryptoKeys/credential-envelope/cryptoKeyVersions/1"
)


class FakeResponse:
    def __init__(self, payload, headers=None):
        self.payload = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        self.headers = headers or {}

    def read(self, maximum=-1):
        return self.payload if maximum < 0 else self.payload[:maximum]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class GcpKmsUnwrapperTests(unittest.TestCase):
    def test_crc32c_matches_castagnoli_reference_vector(self):
        self.assertEqual(crc32c(b"123456789"), 0xE3069283)

    def test_metadata_token_uses_fixed_google_endpoint_and_caches_short_lived_identity(self):
        calls = []

        def open_metadata(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(
                {"access_token": "a" * 40, "expires_in": 3600, "token_type": "Bearer"},
                {"Metadata-Flavor": "Google"},
            )

        provider = GcpMetadataTokenProvider(open_metadata, clock=lambda: 1000)
        self.assertEqual(provider(), "a" * 40)
        self.assertEqual(provider(), "a" * 40)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0].full_url, METADATA_TOKEN_URL)
        self.assertEqual(calls[0][0].get_header("Metadata-flavor"), "Google")

    def test_metadata_response_without_google_identity_header_fails_closed(self):
        provider = GcpMetadataTokenProvider(
            lambda _request, timeout: FakeResponse(
                {"access_token": "a" * 40, "expires_in": 3600}, {}
            )
        )
        with self.assertRaisesRegex(RuntimeError, "not verified"):
            provider()

    def test_hsm_unwrap_binds_alias_resource_and_verifies_both_checksums(self):
        wrapped = bytes(range(256))
        aes_key = bytes(range(32))
        requests = []

        def open_kms(request, timeout):
            requests.append((request, timeout))
            return FakeResponse({
                "plaintext": base64.b64encode(aes_key).decode("ascii"),
                "plaintextCrc32c": str(crc32c(aes_key)),
                "verifiedCiphertextCrc32c": True,
            })

        unwrapper = GcpKmsUnwrapper(
            KEY_ALIAS, KEY_RESOURCE,
            token_provider=lambda: "t" * 40,
            opener=open_kms,
        )
        self.assertEqual(unwrapper.unwrap_rsa_oaep_sha256(KEY_ALIAS, wrapped), aes_key)
        request = requests[0][0]
        self.assertEqual(
            request.full_url,
            f"{KMS_API_ORIGIN}/v1/{KEY_RESOURCE}:asymmetricDecrypt",
        )
        sent = json.loads(request.data)
        self.assertEqual(sent["ciphertextCrc32c"], str(crc32c(wrapped)))
        self.assertEqual(base64.b64decode(sent["ciphertext"]), wrapped)
        self.assertNotIn(aes_key, request.data)

    def test_wrong_alias_and_invalid_resource_never_reach_cloud_kms(self):
        called = False

        def should_not_open(_request, timeout):
            nonlocal called
            called = True
            raise AssertionError("network must not be called")

        unwrapper = GcpKmsUnwrapper(
            KEY_ALIAS, KEY_RESOURCE,
            token_provider=lambda: "t" * 40,
            opener=should_not_open,
        )
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            unwrapper.unwrap_rsa_oaep_sha256("wrong-key", bytes(256))
        self.assertFalse(called)
        with self.assertRaisesRegex(RuntimeError, "resource is invalid"):
            GcpKmsUnwrapper(KEY_ALIAS, "https://evil.invalid/key")

    def test_unverified_or_tampered_kms_response_fails_closed(self):
        aes_key = bytes(range(32))
        payload = {
            "plaintext": base64.b64encode(aes_key).decode("ascii"),
            "plaintextCrc32c": str(crc32c(aes_key)),
            "verifiedCiphertextCrc32c": False,
        }
        unwrapper = GcpKmsUnwrapper(
            KEY_ALIAS, KEY_RESOURCE,
            token_provider=lambda: "t" * 40,
            opener=lambda _request, timeout: FakeResponse(payload),
        )
        with self.assertRaisesRegex(RuntimeError, "ciphertext integrity"):
            unwrapper.unwrap_rsa_oaep_sha256(KEY_ALIAS, bytes(256))
        payload["verifiedCiphertextCrc32c"] = True
        payload["plaintextCrc32c"] = "1"
        with self.assertRaisesRegex(RuntimeError, "plaintext integrity"):
            unwrapper.unwrap_rsa_oaep_sha256(KEY_ALIAS, bytes(256))


if __name__ == "__main__":
    unittest.main()

