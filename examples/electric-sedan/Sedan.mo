model Sedan "Concept sedan; flat road; SI dynamics; names map to SysML parts"
  output Real battery(start=0.8, fixed=true) "State of charge fraction";
  output Real inverter "Inverter electrical output W";
  output Real motor(start=0, fixed=true) "Vehicle speed m/s";
protected
  constant Real mass=1800;
  constant Real capacity=216000000 "60 kWh in J";
  constant Real etaInverter=0.96;
  constant Real etaMotor=0.92;
  constant Real rolling=176.58 "m*g*Crr, Crr=0.01";
  constant Real drag=0.40425 "0.5*rho*Cd*A";
  Real command;
  Real wheelForce;
  Real resistance;
equation
  command = if time < 5 then 4000 + 11200*time
    elseif time < 20 then 60000
    elseif time < 35 then 12000
    else (rolling + drag*20^2)*20/etaMotor;
  inverter = command;
  der(battery) = -inverter/(etaInverter*capacity);
  wheelForce = min(4500, etaMotor*inverter/max(motor, 1));
  resistance = rolling*min(1, max(0, motor)/0.5) + drag*motor^2;
  der(motor) = (wheelForce-resistance)/mass;
  annotation(experiment(StartTime=0, StopTime=60, Interval=0.01, Tolerance=1e-6));
end Sedan;
