package PayloadBay {
    private import ScalarValues::*;
    private import SI::*;

    doc /* Illustrative instrument bay for exercising SysML structure, physical
           preview and a recorded numerical trajectory together.
           X points forward, Y to the left and Z up. Dimensions are millimetres.
           This is not a qualified payload, a thermal design or an FMI execution. */

    port def SamplePort {
        out attribute value : Real;
    }

    part def Sensor {
        port output : SamplePort;
        item probe : ShapeItems::RightCircularCylinder {
            attribute :>> radius = 16 [mm];
            attribute :>> height = 48 [mm];
            attribute axis : String = "Z";
            attribute color : String = "#2F6F8F";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 0 [mm];
        }
        item lens : ShapeItems::Sphere {
            attribute :>> radius = 10 [mm];
            attribute color : String = "#D7E6EE";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 34 [mm];
        }
    }

    part def Controller {
        port input : ~SamplePort;
        port output : SamplePort;
        item housing : ShapeItems::RectangularCuboid {
            attribute :>> length = 120 [mm];
            attribute :>> width = 80 [mm];
            attribute :>> height = 28 [mm];
            attribute color : String = "#3E4A3A";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 0 [mm];
        }
    }

    part def Heater {
        port input : ~SamplePort;
        port output : SamplePort;
        item element : ShapeItems::RectangularCuboid {
            attribute :>> length = 70 [mm];
            attribute :>> width = 40 [mm];
            attribute :>> height = 8 [mm];
            attribute color : String = "#B15A3C";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 0 [mm];
        }
    }

    part def Radiator {
        port input : ~SamplePort;
        item panel {
            attribute shape : String = "loft";
            attribute color : String = "#8EA0AE";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 0 [mm];
            item root {
                attribute x = 0 [mm];
                attribute lowerZ = -8 [mm];
                attribute upperZ = 8 [mm];
                attribute lowerWidth = 90 [mm];
                attribute upperWidth = 90 [mm];
                attribute shoulderZ = 0 [mm];
                attribute shoulderWidth = 90 [mm];
            }
            item mid {
                attribute x = 140 [mm];
                attribute lowerZ = -18 [mm];
                attribute upperZ = 22 [mm];
                attribute lowerWidth = 150 [mm];
                attribute upperWidth = 120 [mm];
                attribute shoulderZ = 4 [mm];
                attribute shoulderWidth = 160 [mm];
            }
            item tip {
                attribute x = 260 [mm];
                attribute lowerZ = -6 [mm];
                attribute upperZ = 10 [mm];
                attribute lowerWidth = 70 [mm];
                attribute upperWidth = 46 [mm];
                attribute shoulderZ = 2 [mm];
                attribute shoulderWidth = 78 [mm];
            }
        }
    }

    part bay {
        item deck : ShapeItems::RectangularCuboid {
            attribute :>> length = 420 [mm];
            attribute :>> width = 260 [mm];
            attribute :>> height = 12 [mm];
            attribute color : String = "#5C6670";
            attribute centerX = 0 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 6 [mm];
        }
        item antenna : ShapeItems::RightCircularCone {
            attribute :>> radius = 22 [mm];
            attribute :>> height = 70 [mm];
            attribute axis : String = "Z";
            attribute color : String = "#C4B089";
            attribute centerX = -150 [mm];
            attribute centerY = -70 [mm];
            attribute centerZ = 47 [mm];
        }
        part sensor : Sensor {
            attribute centerX = -120 [mm];
            attribute centerY = 40 [mm];
            attribute centerZ = 46 [mm];
        }
        part controller : Controller {
            attribute centerX = 10 [mm];
            attribute centerY = 50 [mm];
            attribute centerZ = 26 [mm];
        }
        part heater : Heater {
            attribute centerX = 40 [mm];
            attribute centerY = -20 [mm];
            attribute centerZ = 16 [mm];
        }
        part radiator : Radiator {
            attribute centerX = 210 [mm];
            attribute centerY = 0 [mm];
            attribute centerZ = 40 [mm];
        }

        connection sensorToController connect sensor.output to controller.input;
        connection controllerToHeater connect controller.output to heater.input;
        connection heaterToRadiator connect heater.output to radiator.input;
        flow temperature from sensor.output to controller.input;
    }

    attribute sensorLimit : Real = 293.15;
    requirement def SensorBand {
        doc /* The sensor temperature should approach the 20 °C band.
               A numerical trajectory can be compared with this limit.
               This requirement is not a completed thermal qualification. */
    }
    requirement sensorContract : SensorBand;
    assert constraint sensorWithinBand { sensorLimit > 273.15 and sensorLimit < 313.15 }
}
