model PayloadThermal
  // Companion trajectory for PayloadBay.sysml. Names match the SysML part usages
  // so the workbench can bind samples onto the structure. Temperatures are kelvin
  // and heater is watts. This is a lumped illustration, not a qualified thermal model.
  Real sensor(start = 263.15, fixed = true);
  Real controller(start = 263.15, fixed = true);
  Real heater(start = 0, fixed = true);
  Real radiator(start = 250.15, fixed = true);
equation
  der(sensor) = (controller - sensor) / 30;
  der(controller) = ((sensor + radiator) / 2 - controller) / 20 + 0.12 * heater;
  der(heater) = ((if sensor < 288.15 then 16 else 0) - heater) / 8;
  der(radiator) = (controller - radiator) / 90 - 0.008 * (radiator - 230);
end PayloadThermal;
