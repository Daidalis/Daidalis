model Sedan
  // Concept design; level road, constant efficiencies, no tire slip or thermal model.
  parameter Real mass = 1800 "kg";
  parameter Real capacity = 216e6 "J, 60 kWh";
  parameter Real etaInv = 0.96;
  parameter Real etaMotor = 0.92;
  parameter Real rolling = 0.012;
  parameter Real CdA = 0.62 "m2";
  parameter Real rho = 1.225 "kg/m3";
  output Real battery(start=80, fixed=true) "% SOC";
  output Real inverter "kW AC power";
  output Real motor "km/h road speed";
  Real speed(start=0, fixed=true) "m/s";
  Real command "W DC power";
  Real force "N";
  Real losses "N";
  Real effectivePower "W";
  Real motorTorque "Nm, motor shaft";
  Real dcEnergy(start=0, fixed=true) "J";
  Real kineticEnergy "J";
  Real roadEnergy(start=0, fixed=true) "J";
  Real balanceError "J";
 equation
  command = if time < 8 then 6000 + 6750*time else if time < 20 then 60000 else if time < 32 then 18000 else 12000;
  inverter = etaInv*command/1000;
  force = min(etaMotor*inverter*1000/max(speed,1),4800);
  losses = mass*9.81*rolling*tanh(speed/0.1) + 0.5*rho*CdA*speed^2;
  mass*der(speed) = force-losses;
  motor = 3.6*speed;
  // Launch force cap implies deliberate unused electrical power, not unphysical free energy.
  effectivePower = force*speed;
  der(battery) = -100*command/capacity;
  der(dcEnergy) = command;
  der(roadEnergy) = losses*speed;
  kineticEnergy = 0.5*mass*speed^2;
  balanceError = kineticEnergy + roadEnergy - etaInv*etaMotor*dcEnergy;
  motorTorque = force*0.330/9;
 annotation(experiment(StartTime=0,StopTime=60,Interval=0.1,Tolerance=1e-6));
end Sedan;
