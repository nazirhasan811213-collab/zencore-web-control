import json
import urllib.parse
import unittest
import uuid

from gcp_control_plane import (
    ControlPlaneError,
    GcpControlPlaneClient,
    METADATA_IDENTITY_ENDPOINT,
)


ORIGIN = "https://zencore-precision-entry.onrender.com"
ACCOUNT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
LEASE_ID = "11111111-2222-4333-8444-555555555555"
COMMAND_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb"
REQUEST_ID = uuid.UUID("99999999-8888-4777-8666-555555555555")
TOKEN = ".".join(["a" * 40, "b" * 120, "c" * 342])


class FakeResponse:
    def __init__(self, payload, headers=None, final_url=None):
        self.payload = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        self.headers = headers or {}
        self.final_url = final_url

    def read(self, maximum=-1):
        return self.payload if maximum < 0 else self.payload[:maximum]

    def geturl(self):
        return self.final_url

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class GcpControlPlaneClientTests(unittest.TestCase):
    def test_lease_uses_full_instance_identity_and_fresh_replay_fields(self):
        calls = []

        def open_request(request, timeout):
            calls.append((request, timeout))
            if len(calls) == 1:
                return FakeResponse(TOKEN, {"Metadata-Flavor": "Google"})
            return FakeResponse(
                json.dumps({"ok": True, "lease": {"executionEnabled": False}}),
                {"Content-Type": "application/json; charset=utf-8"},
                request.full_url,
            )

        client = GcpControlPlaneClient(
            ORIGIN,
            opener=open_request,
            clock=lambda: 1_790_000_000.125,
            uuid_factory=lambda: REQUEST_ID,
        )
        result = client.lease(ACCOUNT_ID, "zencore-mt5-demo-01")
        self.assertFalse(result["lease"]["executionEnabled"])
        metadata_request = calls[0][0]
        parsed = urllib.parse.urlsplit(metadata_request.full_url)
        self.assertEqual(
            f"{parsed.scheme}://{parsed.netloc}{parsed.path}", METADATA_IDENTITY_ENDPOINT
        )
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(query["audience"], [f"{ORIGIN}/api/hosted-execution"])
        self.assertEqual(query["format"], ["full"])
        self.assertEqual(metadata_request.get_header("Metadata-flavor"), "Google")

        post_request = calls[1][0]
        self.assertEqual(post_request.full_url, f"{ORIGIN}/api/hosted-execution/lease")
        self.assertEqual(post_request.get_header("Authorization"), f"Bearer {TOKEN}")
        body = json.loads(post_request.data)
        self.assertEqual(body["accountId"], ACCOUNT_ID)
        self.assertEqual(body["cellId"], "zencore-mt5-demo-01")
        self.assertEqual(body["requestId"], str(REQUEST_ID))
        self.assertEqual(body["requestTimestamp"], 1_790_000_000_125)

    def test_hosted_command_poll_and_ack_use_identity_authenticated_posts(self):
        calls = []

        def open_request(request, _timeout):
            calls.append(request)
            if len(calls) in (1, 3):
                return FakeResponse(TOKEN, {"Metadata-Flavor": "Google"})
            if len(calls) == 2:
                return FakeResponse(
                    json.dumps({"ok": True, "command": None}),
                    {"Content-Type": "application/json"},
                    request.full_url,
                )
            return FakeResponse(
                json.dumps({"ok": True, "commandId": COMMAND_ID, "status": "EXECUTED"}),
                {"Content-Type": "application/json"},
                request.full_url,
            )

        client = GcpControlPlaneClient(
            ORIGIN,
            opener=open_request,
            clock=lambda: 1_790_000_000.125,
            uuid_factory=lambda: REQUEST_ID,
        )
        self.assertIsNone(client.next_command(ACCOUNT_ID, LEASE_ID))
        ack = client.acknowledge(
            ACCOUNT_ID,
            LEASE_ID,
            COMMAND_ID,
            "EXECUTED",
            {"code": "ARMED", "message": "DEMO armed"},
        )
        self.assertEqual(ack["status"], "EXECUTED")
        poll = calls[1]
        self.assertEqual(
            poll.full_url, f"{ORIGIN}/api/hosted-execution/commands/next"
        )
        poll_body = json.loads(poll.data)
        self.assertEqual(poll_body["accountId"], ACCOUNT_ID)
        self.assertEqual(poll_body["leaseId"], LEASE_ID)
        ack_request = calls[3]
        self.assertEqual(
            ack_request.full_url,
            f"{ORIGIN}/api/hosted-execution/commands/{COMMAND_ID}/ack",
        )
        ack_body = json.loads(ack_request.data)
        self.assertEqual(ack_body["status"], "EXECUTED")
        self.assertEqual(ack_body["code"], "ARMED")

    def test_heartbeat_never_accepts_transport_redirects(self):
        count = 0

        def open_request(request, _timeout):
            nonlocal count
            count += 1
            if count == 1:
                return FakeResponse(TOKEN, {"Metadata-Flavor": "Google"})
            return FakeResponse(
                '{"ok":true}', {"Content-Type": "application/json"},
                "https://different.invalid/api/hosted-execution/heartbeat",
            )

        client = GcpControlPlaneClient(ORIGIN, opener=open_request)
        with self.assertRaises(ControlPlaneError):
            client.heartbeat({"accountId": ACCOUNT_ID, "leaseId": LEASE_ID})

    def test_unverified_metadata_response_fails_closed_before_control_plane(self):
        calls = 0

        def open_request(_request, _timeout):
            nonlocal calls
            calls += 1
            return FakeResponse(TOKEN)

        client = GcpControlPlaneClient(ORIGIN, opener=open_request)
        with self.assertRaises(ControlPlaneError):
            client.lease(ACCOUNT_ID, "zencore-mt5-demo-01")
        self.assertEqual(calls, 1)

    def test_origin_and_worker_identifiers_are_strict(self):
        for invalid in (
            "http://zencore.example",
            "https://user:password@zencore.example",
            "https://zencore.example/path",
            "https://zencore.example?next=evil",
        ):
            with self.assertRaises(ValueError):
                GcpControlPlaneClient(invalid)
        client = GcpControlPlaneClient(ORIGIN, opener=lambda *_args: None)
        with self.assertRaises(ValueError):
            client.lease("not-a-uuid", "zencore-mt5-demo-01")
        with self.assertRaises(ValueError):
            client.lease(ACCOUNT_ID, "INVALID CELL")
        with self.assertRaises(ValueError):
            client.heartbeat({
                "accountId": ACCOUNT_ID,
                "leaseId": LEASE_ID,
                "nested": {"password": "must-never-leave-worker"},
            })


if __name__ == "__main__":
    unittest.main()
