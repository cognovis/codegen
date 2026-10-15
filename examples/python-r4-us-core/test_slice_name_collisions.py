"""Slices whose names collapse onto one Python accessor stay distinct slices.

`snakeCase` splits on both lower->Upper and `_`, so the slice names
`alleleDatabase`, `allele_database`, `allele__database` and `allele___database`
all snake-case to `allele_database`. The accessor resolver keeps the *methods*
apart by falling through field-qualified name candidates, but each slice also
owns a match constant, and every accessor reads its slice through that constant.

Two defects lived there, both silent at generation time:

- The match constant was named from the raw slice name, so two slices declared
  one constant twice. Python keeps the last definition, so both setters wrote,
  and both getters read, the *second* slice — one slice's data overwrote the
  other's.
- When every name candidate was taken, the resolver handed back the preferred
  name anyway, so the module declared that accessor twice and the earlier one
  became unreachable.

Each constant is now named from its slice's own collision-free accessor name,
and an exhausted resolver suffixes deterministically, as the TypeScript writer
does. The order is fixed: field accessors first, then extensions, then slices in
declaration order.
"""

from typing import Any

from fhir_types.hl7_fhir_r4_core.base import CodeableConcept
from fhir_types.example_synthetic_collisions.profiles.observation_colliding_observation import (
    CollidingObservationProfile,
)
from fhir_types.example_synthetic_collisions.profiles.observation_exhausting_observation import (
    ExhaustingObservationProfile,
)


def _components(resource: Any) -> list[tuple[str, str]]:
    """Each component as (discriminator code, value), in resource order."""
    return [(c.code.coding[0].code, c.valueString) for c in resource.component]


# --- two colliding slices ------------------------------------------------------


def test_two_colliding_slices_write_two_components_with_their_own_codes() -> None:
    profile = CollidingObservationProfile.create(status="final", code=CodeableConcept(text="probe"))

    profile.set_allele_database({"valueString": "first-value"})
    profile.set_component_allele_database({"valueString": "second-value"})

    assert sorted(_components(profile.to_resource())) == [("first", "first-value"), ("second", "second-value")]


def test_each_getter_returns_its_own_slice() -> None:
    profile = CollidingObservationProfile.create(status="final", code=CodeableConcept(text="probe"))
    profile.set_allele_database({"valueString": "first-value"})
    profile.set_component_allele_database({"valueString": "second-value"})

    assert profile.get_allele_database() == {"valueString": "first-value"}
    assert profile.get_component_allele_database() == {"valueString": "second-value"}


def test_setting_one_slice_again_leaves_the_other_alone() -> None:
    profile = CollidingObservationProfile.create(status="final", code=CodeableConcept(text="probe"))
    profile.set_allele_database({"valueString": "first-value"})
    profile.set_component_allele_database({"valueString": "second-value"})

    profile.set_allele_database({"valueString": "first-replaced"})

    assert sorted(_components(profile.to_resource())) == [("first", "first-replaced"), ("second", "second-value")]


# --- four colliding slices, more than the candidates can separate --------------

def _setters() -> list[tuple[str, Any]]:
    """The four setters with the discriminator code each one writes.

    Built on demand rather than at import, so a missing setter fails these tests
    and not the collection of every test in the module.
    """
    return [
        ("c0", ExhaustingObservationProfile.set_allele_database),
        ("c1", ExhaustingObservationProfile.set_component_allele_database),
        ("c2", ExhaustingObservationProfile.set_component_allele_database_slice),
        # Every name candidate is taken by now, so the resolver suffixes.
        ("c3", ExhaustingObservationProfile.set_allele_database_2),
    ]


def test_four_colliding_slices_get_four_distinct_setters() -> None:
    assert len({id(setter) for _, setter in _setters()}) == 4


def test_four_colliding_slices_write_four_distinct_components() -> None:
    profile = ExhaustingObservationProfile.create(status="final", code=CodeableConcept(text="probe"))

    for code, setter in _setters():
        setter(profile, {"valueString": f"value-{code}"})

    assert sorted(_components(profile.to_resource())) == [
        ("c0", "value-c0"),
        ("c1", "value-c1"),
        ("c2", "value-c2"),
        ("c3", "value-c3"),
    ]


def test_four_colliding_slices_read_back_their_own_values() -> None:
    profile = ExhaustingObservationProfile.create(status="final", code=CodeableConcept(text="probe"))
    for code, setter in _setters():
        setter(profile, {"valueString": f"value-{code}"})

    assert profile.get_allele_database() == {"valueString": "value-c0"}
    assert profile.get_component_allele_database() == {"valueString": "value-c1"}
    assert profile.get_component_allele_database_slice() == {"valueString": "value-c2"}
    assert profile.get_allele_database_2() == {"valueString": "value-c3"}
