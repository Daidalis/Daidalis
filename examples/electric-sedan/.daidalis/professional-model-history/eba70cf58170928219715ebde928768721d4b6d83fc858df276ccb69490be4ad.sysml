package ElectricSedan {
    private import ScalarValues::*;
    private import AnalysisTooling::*;
    item def PowerTransfer { attribute watts : Real; }
    item def TorqueTransfer { attribute newtonMetres : Real; }
    part sedan {
        part battery { out item powerOut : PowerTransfer; }
        part inverter {
            in item powerIn : PowerTransfer;
            out item torqueOut : TorqueTransfer;
        }
        part motor { in item torqueIn : TorqueTransfer; }
        flow powerFlow of PowerTransfer from battery.powerOut to inverter.powerIn;
        flow torqueFlow of TorqueTransfer from inverter.torqueOut to motor.torqueIn;
    }
    attribute mass : Real = 1800;
    attribute capacity : Real = 216000000;
    attribute etaInverter : Real = 0.96;
    attribute etaMotor : Real = 0.92;
    attribute rolling : Real = 176.58;
    attribute drag : Real = 0.40425;
    attribute command : Real;
    attribute wheelForce : Real;
    attribute resistance : Real;
    calc def Launch {
        doc /* battery=SOC fraction; inverter=electrical W; motor=vehicle m/s. Torque interface is an architectural abstraction, not an inverter mechanical shaft. */
        metadata ToolExecution {
            toolName = "fmi";
            uri = "file:///work/electric-sedan/Sedan.fmu";
        }
        in startTime : Real = 0.0 { @ToolVariable { name = "fmi:startTime"; } }
        in stopTime : Real = 60.0 { @ToolVariable { name = "fmi:stopTime"; } }
        in stepSize : Real = 0.01 { @ToolVariable { name = "fmi:stepSize"; } }
        return battery : Real { @ToolVariable { name = "battery"; } }
        out inverter : Real { @ToolVariable { name = "inverter"; } }
        out motor : Real { @ToolVariable { name = "motor"; } }
    }
    analysis def LaunchAnalysis {
        calc launch : Launch;
        return finalSpeed : Real = launch.motor;
    }
}
