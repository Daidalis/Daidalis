package CoastDemo {
    private import ScalarValues::*;
    private import AnalysisTooling::*;

    part car;

    calc def Coast {
        metadata ToolExecution {
            toolName = "fmi";
            uri = "file:///examples/agent-opus-run/CoastDemo.fmu";
        }
        in stopTime : Real = 8.0 {
            @ToolVariable { name = "fmi:stopTime"; }
        }
        in stepSize : Real = 0.05 {
            @ToolVariable { name = "fmi:stepSize"; }
        }
        return v : Real[1] {
            @ToolVariable { name = "v"; }
        }
    }

    analysis def CoastCheck {
        return result : Real = Coast();
        assert constraint { result > 5.5 and result < 6.5 }
    }
}
