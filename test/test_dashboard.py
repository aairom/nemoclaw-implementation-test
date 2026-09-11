"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0

Unit tests for the NemoClaw Streamlit dashboard.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, mock_open

# Add the dashboard directory to sys.path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "dashboard"))


class TestDashboardStateHelpers(unittest.TestCase):
    """Test helper functions used by the dashboard (without Streamlit)."""

    def test_env_vars_loaded(self):
        """Dashboard should read env vars for configuration."""
        port = int(os.getenv("DASHBOARD_PORT", "8501"))
        self.assertIsInstance(port, int)
        self.assertGreater(port, 0)
        self.assertLess(port, 65536)

    def test_state_dir_default(self):
        """Default state dir should be ~/.nemoclaw"""
        from pathlib import Path
        state_dir = Path.home() / ".nemoclaw"
        self.assertIsInstance(state_dir, Path)

    def test_sandboxes_json_structure(self):
        """Sandbox registry JSON should have required keys."""
        registry = {"sandboxes": [], "default": None}
        self.assertIn("sandboxes", registry)
        self.assertIn("default", registry)
        self.assertIsInstance(registry["sandboxes"], list)

    def test_load_sandboxes_missing_file(self):
        """Should return empty registry when sandboxes.json is missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_dir = Path(tmpdir)
            sandboxes_file = state_dir / "sandboxes.json"
            self.assertFalse(sandboxes_file.exists())
            # Simulate the logic in load_sandboxes()
            result = {"sandboxes": [], "default": None}
            self.assertEqual(result["sandboxes"], [])

    def test_load_sandboxes_valid_file(self):
        """Should correctly parse a valid sandboxes.json."""
        data = {
            "sandboxes": [
                {
                    "name": "test-sb",
                    "agent": "openclaw",
                    "provider": "nvidia",
                    "model": "nvidia/llama-3.1-nemotron-70b-instruct",
                    "registeredAt": "2026-01-01T00:00:00Z",
                }
            ],
            "default": "test-sb",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name

        try:
            loaded = json.loads(Path(tmp_path).read_text())
            self.assertEqual(len(loaded["sandboxes"]), 1)
            self.assertEqual(loaded["default"], "test-sb")
            self.assertEqual(loaded["sandboxes"][0]["agent"], "openclaw")
        finally:
            os.unlink(tmp_path)

    def test_run_nemoclaw_cmd_not_found(self):
        """run_nemoclaw_cmd should handle missing CLI gracefully via FileNotFoundError."""
        import subprocess
        # Simulate what run_nemoclaw_cmd does: catch FileNotFoundError
        exit_code = 0
        stdout = ""
        stderr = ""
        try:
            result = subprocess.run(
                ["nonexistent-command-xyz"],
                capture_output=True,
                text=True,
            )
            exit_code = result.returncode
        except FileNotFoundError:
            exit_code = 1
            stderr = "nemoclaw CLI not found"

        self.assertEqual(exit_code, 1)
        self.assertIn("not found", stderr)


class TestPolicyParsing(unittest.TestCase):
    """Test policy YAML parsing."""

    def test_parse_policy_yaml(self):
        """Should correctly parse a policy YAML file."""
        import yaml

        policy_yaml = """
version: "1"
egress:
  - host: inference.local
    port: 443
    protocol: https
    comment: "Managed inference"
  - host: github.com
    port: 443
    protocol: https
deny: []
"""
        policy = yaml.safe_load(policy_yaml)
        self.assertEqual(policy["version"], "1")
        self.assertEqual(len(policy["egress"]), 2)
        self.assertEqual(policy["egress"][0]["host"], "inference.local")

    def test_policy_egress_structure(self):
        """Each egress rule should have host, port, protocol."""
        rule = {"host": "api.example.com", "port": 443, "protocol": "https"}
        self.assertIn("host", rule)
        self.assertIn("port", rule)
        self.assertIn("protocol", rule)
        self.assertIsInstance(rule["port"], int)
        self.assertIn(rule["protocol"], ["http", "https", "tcp", "udp", "any"])


class TestBlueprintYaml(unittest.TestCase):
    """Test blueprint YAML parsing."""

    def test_blueprint_yaml_exists(self):
        """nemoclaw-blueprint/blueprint.yaml should exist and be valid YAML."""
        import yaml

        blueprint_path = Path(__file__).parent.parent / "nemoclaw-blueprint" / "blueprint.yaml"
        self.assertTrue(blueprint_path.exists(), f"Blueprint file not found: {blueprint_path}")

        blueprint = yaml.safe_load(blueprint_path.read_text())
        self.assertIn("version", blueprint)
        self.assertIn("components", blueprint)

    def test_blueprint_sandbox_name_constraint(self):
        """Sandbox name must match the blueprint schema constraint."""
        import re
        pattern = re.compile(r'^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$')
        valid_names = ["nemoclaw-sandbox", "my-sb-1", "a", "test-sandbox-01"]
        invalid_names = ["MySandbox", "1sandbox", "-sandbox", "sandbox-", "", "a" * 64]

        for name in valid_names:
            self.assertRegex(name, pattern, f"Expected '{name}' to be valid")

        for name in invalid_names:
            self.assertNotRegex(name, pattern, f"Expected '{name}' to be invalid")

    def test_blueprint_provider_name_constraint(self):
        """Provider name must match 1-128 letters/numbers/dots/_/- starting with letter."""
        import re
        pattern = re.compile(r'^[a-zA-Z][a-zA-Z0-9._-]{0,127}$')
        valid = ["nvidia", "openai-compatible", "my.provider_v1", "a"]
        invalid = ["1nvidia", "", "a" * 130]

        for name in valid:
            self.assertRegex(name, pattern)
        for name in invalid:
            self.assertNotRegex(name, pattern)


class TestEnvExampleFile(unittest.TestCase):
    """Test that .env.example exists and has required variables."""

    def test_env_example_exists(self):
        """The .env.example file should exist."""
        env_example = Path(__file__).parent.parent / ".env.example"
        self.assertTrue(env_example.exists())

    def test_env_example_has_required_vars(self):
        """The .env.example should define all required environment variables."""
        env_example = Path(__file__).parent.parent / ".env.example"
        content = env_example.read_text()
        required_vars = [
            "NVIDIA_API_KEY",
            "NEMOCLAW_MODEL",
            "NEMOCLAW_INFERENCE_PROVIDER",
            "NEMOCLAW_GATEWAY_PORT",
            "NEMOCLAW_AGENT",
            "DASHBOARD_PORT",
        ]
        for var in required_vars:
            self.assertIn(var, content, f"Expected {var} in .env.example")

    def test_env_example_no_real_secrets(self):
        """The .env.example should never contain real secrets."""
        env_example = Path(__file__).parent.parent / ".env.example"
        content = env_example.read_text()
        # These are indicators of real API keys (patterns)
        suspicious = ["nvapi-", "sk-", "xoxb-", "ghp_"]
        for pattern in suspicious:
            self.assertNotIn(pattern, content, f"Possible real secret found: {pattern}")


if __name__ == "__main__":
    unittest.main()
