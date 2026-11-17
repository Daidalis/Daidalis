package ElectricSedan {
    private import ScalarValues::*;
    private import SI::*;
    private import ISQ::*;
    private import AnalysisTooling::*;

    item def ElectricalPower;
    item def ShaftTorque;
    port def PowerPort { out item power : ElectricalPower; }
    port def TorquePort { out item torque : ShaftTorque; }
    part def Battery { port dc : PowerPort; }
    part def Inverter {
        port dc : ~PowerPort;
        port shaft : TorquePort;
    }
    part def Motor { port shaft : ~TorquePort; }
    part def Sedan {
        part battery : Battery;
        part inverter : Inverter;
        part motor : Motor;
        flow batteryToInverter of ElectricalPower from battery.dc.power to inverter.dc.power;
        flow inverterToMotor of ShaftTorque from inverter.shaft.torque to motor.shaft.torque;
    }
    part sedan : Sedan;

    calc def Launch {
        doc /* Real outputs: battery = SOC fraction, inverter = electrical output W, motor = vehicle speed m/s. Concept model, not measured vehicle data. */
        metadata ToolExecution {
            toolName = "fmi";
            uri = "ElectricSedan.fmu";
        }
        in startTime : Real = 0.0 { @ToolVariable { name = "fmi:startTime"; } }
        in stopTime : Real = 60.0 { @ToolVariable { name = "fmi:stopTime"; } }
        in stepSize : Real = 0.02 { @ToolVariable { name = "fmi:stepSize"; } }
        return battery : Real { @ToolVariable { name = "battery"; } }
        out inverter : Real { @ToolVariable { name = "inverter"; } }
        out motor : Real { @ToolVariable { name = "motor"; } }
    }
    analysis def LaunchAnalysis {
        subject vehicle : Sedan;
        calc launch : Launch;
        out finalSOC : Real = launch.battery;
        out finalPower : Real = launch.inverter;
        out finalSpeed : Real = launch.motor;
        objective launchEnvelope {
            require constraint { finalSOC >= 0.78 and finalSOC <= 0.8 }
            require constraint { finalPower > 0.0 and finalPower < 15000.0 }
            require constraint { finalSpeed > 10.0 and finalSpeed < 25.0 }
        }
    }
    analysis launchCase : LaunchAnalysis { subject vehicle = sedan; }
}
