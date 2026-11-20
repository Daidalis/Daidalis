export const PROFESSIONAL_AUTHORING = {
  sysmlFmi:{
    sourceLayout:'A conventional model entry loads the SysML sources recursively under its sourceRoot. Keep independent structure/physical presentation models outside that root in separate project-relative directories, or compose them into one assembly. Multiple unrelated whole-system usages in one source set prevent physical preview. Every nested assembly wrapper also needs explicit centerX, centerY and centerZ with length units, even when only its children carry shapes; use explicit zero coordinates for a shared parent frame. Semantic validity alone does not establish drawable geometry. Bind each presentation replay manifest to the original verified trajectory without claiming that its geometry was simulated.',
    modelName:'Required: qualified name of the analysis usage or calc to execute, for example Experiment::check.',
    uri:'Use metadata ToolExecution { toolName = "fmi"; uri = "file:///work/models/Plant.fmu"; }. The file:// URI basename must match the pinned FMU filename.',
    experiment:'Bind every supplied simulation field with an in Real[1] feature and @ToolVariable name fmi:startTime, fmi:stopTime, fmi:stepSize or fmi:tolerance. Omit unsupplied fields or declare all four.',
    outputs:'FMI outputs are final scalar values: use [1], never [0..*]. The separate trajectory.csv contains the time series. Read modelDescription.xml inside the actual FMU before writing bindings: dimensionless Real maps to Real[1]; W maps to ISQ::PowerValue[1]; m/s maps to ISQ::SpeedValue[1]; use the corresponding ISQ quantity for other resolved units. An arbitrary Real cannot receive a quantity.',
    analysis:'Normalize quantity outputs to numbers in analysis results, for example run.power / (1 [W]). SysML conditional syntax is if condition ? value else value. Keep assertions and numerical checks tied to the stated requirements; a completed solver with failed checks still needs correction or an explicit failed delivery.',
    example:`package Experiment {
  private import ScalarValues::*;
  private import AnalysisTooling::*;
  private import ISQ::*;
  private import SI::*;
  calc def Simulate {
    metadata ToolExecution { toolName = "fmi"; uri = "file:///work/models/Plant.fmu"; }
    in startTime : Real[1] = 0.0 { @ToolVariable { name = "fmi:startTime"; } }
    in stopTime : Real[1] = 60.0 { @ToolVariable { name = "fmi:stopTime"; } }
    in stepSize : Real[1] = 0.1 { @ToolVariable { name = "fmi:stepSize"; } }
    in tolerance : Real[1] = 0.000001 { @ToolVariable { name = "fmi:tolerance"; } }
    return level : Real[1] { @ToolVariable { name = "level"; } }
    out power : PowerValue[1] { @ToolVariable { name = "power"; } }
    out speed : SpeedValue[1] { @ToolVariable { name = "speed"; } }
  }
  analysis check {
    calc run : Simulate;
    return result : Real[1] = run.level;
    out powerW : Real[1] = run.power / (1 [W]);
    out speedMps : Real[1] = run.speed / (1 [m/s]);
    assert constraint { result >= 0.0 and result <= 1.0 }
  }
}`,
    adaptation:'This is syntax guidance, not a project model or a validated design. Replace Plant.fmu, variable names, experiment settings and checks with the actual project inputs. Use the installed toolchain and this contract before attempting remote documentation.',
    export:'For the installed OpenModelica FMI Co-Simulation route use buildModelFMU(Model, version="2.0", fmuType="cs") after setCommandLineOptions("--fmiFlags=s:euler"). Choose and verify the communication step for the model dynamics. Keep omc initialization/logs out of JSON stdout. The worker seeds /opt/modelica-libraries automatically for native jobs; for a run_command export, symlink that registry under a writable task-local HOME instead of downloading or copying libraries.',
  },
  openscad:{
    preview:'A simulate job exports STL and a color PNG from the same pinned source. The PNG uses an explicit camera with --viewall --autocenter so partial $vp* settings cannot leave it blank or cropped. Author the cutaway for the standard view rotation [62,0,28] and inspect the actual PNG before accepting visibility.',
  },
};
