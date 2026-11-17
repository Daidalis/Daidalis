model ElectricSedan "Concept sedan: flat-road launch, SI internally"
  parameter Real mass=1750 "kg incl occupants";
  parameter Real capacity=60*3.6e6 "J usable battery energy";
  parameter Real etaInv=0.96;
  parameter Real etaMotor=0.92;
  parameter Real forceLimit=4500 "N traction cap";
  parameter Real rolling=0.011;
  parameter Real rho=1.225;
  parameter Real cdA=0.62 "m2";
  parameter Real g=9.81;
  parameter Real cruiseSpeed=16 "m/s";
  output Real battery(start=0.8, fixed=true) "SOC fraction, bound to battery part";
  output Real inverter "Electrical output W, bound to inverter part";
  output Real motor(start=0, fixed=true) "Vehicle speed m/s, bound to motor part";
protected
  Real command "W electrical output request";
  Real resistance "N";
  Real wheelForce "N";
  Real cruisePower "W";
equation
  resistance = mass*g*rolling + 0.5*rho*cdA*motor*motor;
  cruisePower = max(0,(resistance + 650*(cruiseSpeed-motor))*max(motor,1)/etaMotor);
  command = if time < 5 then 2400*time else if time < 18 then 12000+28000*(time-5)/13 else if time < 32 then 40000-24000*(time-18)/14 else min(14000,cruisePower);
  inverter = max(0,command);
  wheelForce = min(forceLimit,etaMotor*inverter/max(motor,1));
  der(motor) = if motor <= 0 and wheelForce < resistance then 0 else (wheelForce-resistance)/mass;
  der(battery) = -(inverter/etaInv + 500)/capacity;
  annotation(experiment(StartTime=0,StopTime=60,Interval=0.02,Tolerance=1e-6));
end ElectricSedan;
