"""The root package imports a `profiles` subpackage only where one was emitted.

With profile generation on, the root `fhir_types/__init__.py` imports each
package's `profiles` subpackage for its side effects. It did so for every package
that has resources, whether or not that package had any profiles — and a package
without profiles gets no `profiles` subpackage. `example.synthetic.types` is such
a package, and so is R4 core itself under a tree shake narrow enough to leave it
no profile. Importing anything from `fhir_types` then failed with
`ModuleNotFoundError`, so a single profile-free package broke the whole SDK.

Every other test in this example imports `fhir_types` too, so before the fix none
of them could even be collected; these pin the contract explicitly.
"""

import importlib.util
import sys

import fhir_types
from fhir_types.example_synthetic_types.synthetic_record import SyntheticRecord


def test_a_package_without_profiles_has_no_profiles_subpackage() -> None:
    assert importlib.util.find_spec("fhir_types.example_synthetic_types.profiles") is None


def test_the_root_package_imports_and_still_registers_emitted_profiles() -> None:
    assert fhir_types.__name__ == "fhir_types"
    assert "fhir_types.hl7_fhir_r4_core.profiles" in sys.modules


def test_a_resource_from_the_profile_free_package_is_usable() -> None:
    record = SyntheticRecord(title="synthetic")

    assert record.resourceType == "SyntheticRecord"
    assert record.title == "synthetic"
