model CoastDemo
  output Real v(start=20, fixed=true);
  output Real s(start=0, fixed=true);
equation
  der(v) = -0.15 * v;
  der(s) = v;
  annotation(experiment(StartTime=0, StopTime=8, Interval=0.05));
end CoastDemo;
