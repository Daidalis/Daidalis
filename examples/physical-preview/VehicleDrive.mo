model VehicleDrive
  "60 s pull-away. battery is state of charge in percent, inverter is kilowatts, motor is km/h."
  Real battery(start = 78, fixed = true);
  Real inverter(start = 0, fixed = true);
  Real motor(start = 0, fixed = true);
  Real command;
equation
  command = if time < 8 then 45 else if time < 25 then 18 else if time < 40 then 0 else 12;
  der(inverter) = (command - inverter) / 1.2;
  der(motor) = (1.6 * inverter - 0.35 * motor) / 3;
  der(battery) = -0.012 * inverter;
  annotation(experiment(StartTime = 0, StopTime = 60, Interval = 0.5, Tolerance = 1e-6));
end VehicleDrive;
