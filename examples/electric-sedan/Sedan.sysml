package SedanSystem {
  private import ScalarValues::*;
  private import AnalysisTooling::*;
  item def Power { attribute watts : Real; }
  item def Torque { attribute newtonMetres : Real; }
  part vehicle {
    doc /* System diagram only. Full physical representation is Sedan.appearance.sysml. */
    attribute mass : Real;
    attribute capacity : Real;
    attribute etaInv : Real;
    attribute etaMotor : Real;
    attribute rolling : Real;
    attribute CdA : Real;
    attribute rho : Real;
    attribute speed : Real;
    attribute command : Real;
    attribute force : Real;
    attribute losses : Real;
    attribute effectivePower : Real;
    attribute motorTorque : Real;
    attribute dcEnergy : Real;
    attribute kineticEnergy : Real;
    attribute roadEnergy : Real;
    attribute balanceError : Real;
    part battery { out item electricalPower : Power; }
    part inverter { in item electricalPower : Power; out item shaftTorque : Torque; }
    part motor { in item shaftTorque : Torque; }
    flow of Power from battery.electricalPower to inverter.electricalPower;
    flow of Torque from inverter.shaftTorque to motor.shaftTorque;
  }
  calc def LaunchFMU {
    metadata ToolExecution {
      toolName = "fmi";
      uri = "file:///work/sedan/build/Sedan.fmu";
    }
    in startTime : Real = 0.0 { @ToolVariable { name = "fmi:startTime"; } }
    in stopTime : Real = 60.0 { @ToolVariable { name = "fmi:stopTime"; } }
    in stepSize : Real = 0.1 { @ToolVariable { name = "fmi:stepSize"; } }
    return battery : Real[1] { @ToolVariable { name = "battery"; } }
    out inverter : Real[1] { @ToolVariable { name = "inverter"; } }
    out motor : Real[1] { @ToolVariable { name = "motor"; } }
  }
  analysis def LaunchAnalysis {
    calc run : LaunchFMU;
    out battery : Real[1] = run.battery;
    out inverter : Real[1] = run.inverter;
    out motor : Real[1] = run.motor;
    objective rangeCheck {
      require constraint { battery > 79.0 and battery < 80.0 and inverter > 11.0 and inverter < 12.0 and motor > 50.0 and motor < 100.0 }
    }
  }
  analysis launch : LaunchAnalysis;
}
