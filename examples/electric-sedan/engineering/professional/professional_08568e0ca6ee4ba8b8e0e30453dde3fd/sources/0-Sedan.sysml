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

    calc def Launch {
        doc /* Plain Real outputs: battery=SOC fraction, inverter=electrical W, motor=vehicle m/s. */
        metadata ToolExecution {
            toolName = "fmi";
            uri = "Sedan.fmu";
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
