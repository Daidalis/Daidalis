import csv
import json
from pathlib import Path

from fmpy import simulate_fmu

result = simulate_fmu(
    filename="/tmp/CoastDemo.fmu",
    fmi_type="CoSimulation",
    start_time=0,
    stop_time=8,
    step_size=0.05,
    output_interval=0.05,
    output=["v", "s"],
    validate=False,
)

trajectory = Path("/tmp/CoastDemo-trajectory.csv")
with trajectory.open("x", newline="") as stream:
    writer = csv.writer(stream)
    writer.writerow(["time", "v", "s"])
    for row in result:
        writer.writerow([format(float(row[name]), ".17g") for name in ("time", "v", "s")])

first = {name: float(result[0][name]) for name in ("time", "v", "s")}
last = {name: float(result[-1][name]) for name in ("time", "v", "s")}
passed = 5.5 < last["v"] < 6.5
print(json.dumps({"rows": len(result), "first": first, "last": last, "CoastCheck": passed}, indent=2))
assert len(result) == 161
assert first == {"time": 0.0, "v": 20.0, "s": 0.0}
assert last["time"] == 8.0
assert passed, "CoastCheck failed"
