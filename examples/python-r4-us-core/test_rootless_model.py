"""A complex type with no base still gets a working pydantic model.

`SyntheticRoot` declares no base definition, so the generated class has no
parent to inherit a model root from. The writer falls back to the client's model
root — `FhirpyBaseModel` under the default fhirpy client — but complex types are
emitted into the package's `base.py`, which never imported it. The module then
raised `NameError` on import, so the whole package was unusable. A resource
module always imported the root, which is why only complex types were affected.

`client: "none"` falls back to pydantic's `BaseModel`, which `base.py` already
imports, so it never had the problem.

The type declares no elements: a field would need an import of another
package's types, which `base.py` does not emit either — a separate defect.
"""

import pytest
from fhir_types.example_synthetic_types.base import SyntheticRoot
from fhir_types.fhirpy_base_model import FhirpyBaseModel
from pydantic import ValidationError


def test_the_rootless_model_falls_back_to_the_fhirpy_root() -> None:
    assert issubclass(SyntheticRoot, FhirpyBaseModel)


def test_the_rootless_model_instantiates() -> None:
    assert SyntheticRoot().model_dump(exclude_none=True) == {}


# Without a model root, model_config would be an inert class attribute and
# nothing would be rejected. A live `extra="forbid"` proves the root is real.
def test_the_rootless_model_enforces_its_config() -> None:
    with pytest.raises(ValidationError):
        SyntheticRoot.model_validate({"undeclared": "value"})
