package VisualizationDemo {
    private import ScalarValues::*;

    port def SamplePort {
        out attribute value : Real;
    }

    part def Sensor {
        port output : SamplePort;
    }

    part def Relay {
        port input : ~SamplePort;
        port output : SamplePort;
    }

    part def Estimator {
        port input : ~SamplePort;
    }

    part signalChain {
        part sensor : Sensor;
        part uart : Relay;
        part flightSoftware : Relay;
        part attitudeEstimator : Estimator;

        connection sensorToUart connect sensor.output to uart.input;
        connection uartToSoftware connect uart.output to flightSoftware.input;
        connection softwareToEstimator connect flightSoftware.output to attitudeEstimator.input;
    }
}
