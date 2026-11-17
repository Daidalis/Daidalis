package ElectricSedan {
    private import ScalarValues::*;
    private import AnalysisTooling::*;
    item def ElectricalPower;
    item def ShaftTorque;
    port def PowerPort { out item power : ElectricalPower; }
    port def TorquePort { out item torque : ShaftTorque; }
    part def Battery { port dc : PowerPort; }
    part def Inverter { port dc : ~PowerPort; port shaft : TorquePort; }
    part def Motor { port shaft : ~TorquePort; }
    part def Sedan {
        part battery : Battery;
        part inverter : Inverter;
        part motor : Motor;
        flow batteryToInverter of ElectricalPower from battery.dc.power to inverter.dc.power;
        flow inverterToMotor of ShaftTorque from inverter.shaft.torque to motor.shaft.torque;
        attribute mass : Real = 1750.0;
        attribute capacity : Real = 216000000.0;
        attribute etaInv : Real = 0.96;
        attribute etaMotor : Real = 0.92;
        attribute forceLimit : Real = 4500.0;
        attribute rolling : Real = 0.011;
        attribute rho : Real = 1.225;
        attribute cdA : Real = 0.62;
        attribute g : Real = 9.81;
        attribute cruiseSpeed : Real = 16.0;
        attribute command : Real;
        attribute resistance : Real;
        attribute wheelForce : Real;
        attribute cruisePower : Real;
    }
    part sedan : Sedan;
    calc def Launch {
        doc /* Plain Real outputs: battery SOC fraction; inverter W electrical output; motor m/s vehicle speed. All numerical inputs are concept assumptions, not measurements. */
        metadata ToolExecution {
            toolName = "fmi";
            uri = "file:///work/electric-sedan/ElectricSedan.fmu";
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
