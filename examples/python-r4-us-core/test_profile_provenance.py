"""US Core Provenance Profile Class API Tests

US Core restates `Provenance.target`, whose base type is `Reference(Any)` — its
only declared target is the abstract `Resource` type, which admits a reference to
*any* resource. An open target set like that cannot be validated against a closed
list: the concrete resources the generator knows are whatever survived tree
shaking, not what the profile permits. So no reference check is emitted for
`target` at all.

The contrast is `Observation.performer`, whose declared targets are an explicit
list. Those stay validated, and on every entry of the repeating element.

`target` is `1..*`, so the element holds a list of References. Mirrors
`examples/typescript-r4-us-core/profile-us-core-provenance.test.ts`.
"""

from pathlib import Path

import pytest
from fhir_types.hl7_fhir_r4_core.base import Reference
from fhir_types.hl7_fhir_r4_core.provenance import ProvenanceAgent
from fhir_types.hl7_fhir_us_core.profiles.observation_uscore_blood_pressure_profile import (
    UscoreBloodPressureProfile,
)
from fhir_types.hl7_fhir_us_core.profiles.provenance_uscore_provenance import (
    UscoreProvenanceProfile,
)

GENERATED_SOURCE = (
    Path(__file__).parent / "fhir_types/hl7_fhir_us_core/profiles/provenance_uscore_provenance.py"
).read_text()

RECORDED = "2024-06-15T10:00:00Z"

PERFORMER_ERROR = (
    "UscoreBloodPressureProfile: field 'performer' references 'Device' but only "
    "CareTeam, Organization, Patient, Practitioner, PractitionerRole, RelatedPerson are allowed"
)


def _agent() -> list[ProvenanceAgent]:
    return [ProvenanceAgent(who=Reference(reference="Practitioner/pr-1"))]


# --- demo ------------------------------------------------------------------


def test_build_a_provenance_resource_targeting_a_patient() -> None:
    profile = UscoreProvenanceProfile.create(
        target=[Reference(reference="Patient/pt-1")],
        recorded=RECORDED,
        agent=_agent(),
    )

    assert profile.validate()["errors"] == []


# --- an open reference target emits no check --------------------------------


def test_no_reference_check_is_generated_for_target() -> None:
    assert 'validate_reference(self._resource, profile_name, "target"' not in GENERATED_SOURCE


@pytest.mark.parametrize(
    "target",
    [
        # Practitioner is a legal Provenance.target but was shaken out of this index.
        [Reference(reference="Practitioner/pr-1")],
        [Reference(reference="Patient/pt-1"), Reference(reference="Practitioner/pr-1")],
        [Reference(reference="Patient/pt-1")],
    ],
    ids=["shaken-out type", "shaken-out type after a permitted one", "only permitted types"],
)
def test_an_open_target_accepts_any_resource_reference(target: list[Reference]) -> None:
    profile = UscoreProvenanceProfile.create(target=target, recorded=RECORDED, agent=_agent())

    assert profile.validate()["errors"] == []


# --- a closed reference target is still checked on every entry --------------


def _bp_with_performer(*references: str) -> UscoreBloodPressureProfile:
    """A valid-shaped BP observation carrying the given performer references.

    `performer` is not a `create` argument on this profile, so it is set on the
    underlying resource and the profile is applied over it — which is also the
    shape a consumer gets when it parses an Observation from a server.
    """
    resource = UscoreBloodPressureProfile.create_resource(
        status="final",
        subject=Reference(reference="Patient/pt-1"),
    )
    resource.performer = [Reference(reference=reference) for reference in references]
    return UscoreBloodPressureProfile.apply(resource)


def test_a_permitted_performer_passes() -> None:
    assert PERFORMER_ERROR not in _bp_with_performer("Practitioner/pr-1").validate()["errors"]


def test_a_disallowed_performer_is_reported() -> None:
    assert PERFORMER_ERROR in _bp_with_performer("Device/dev-1").validate()["errors"]


def test_a_disallowed_performer_after_a_permitted_one_is_reported() -> None:
    errors = _bp_with_performer("Practitioner/pr-1", "Device/dev-1").validate()["errors"]

    assert PERFORMER_ERROR in errors
