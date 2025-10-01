"""
Pytest configuration and shared fixtures for FDX parser tests.
"""
from pathlib import Path
import pytest

# Make repo root easily accessible
@pytest.fixture(scope="session")
def repo_root():
    """Return the repository root directory."""
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def test_assets_dir(repo_root):
    """Return the test_assets directory."""
    return repo_root / "test_assets"


@pytest.fixture(scope="session")
def all_fdx_files(test_assets_dir):
    """Return list of all .fdx files in test_assets."""
    return sorted(list(test_assets_dir.glob("*.fdx")))
