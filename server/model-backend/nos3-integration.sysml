package NOS3StarTrackerIntegration {
    private import ScalarValues::*;
    doc /* Source-linked reconstruction for a task-specific NASA NOS3 mission.
           Execute 42, NOSengine, the star-tracker simulator, cFS and ADCS in
           the isolated Linux guest. This source is not a NASA-issued model.
           SysML validation alone does not execute this mission. */
    attribute rotationToleranceDeg : Real = 0.02;
    attribute def Quaternion {
        attribute scalar : Real;
        attribute x : Real;
        attribute y : Real;
        attribute z : Real;
    }
    port def MeasuredAttitude { attribute sample : Quaternion; }
    port def ReferenceAttitude { attribute reference : Quaternion; }
    part def Dynamics42 { port truthReference : ReferenceAttitude; }
    part def StarTrackerSimulator { port measuredOutput : MeasuredAttitude; }
    part def NosEngineUart { port measurement : MeasuredAttitude; }
    part def FlightSoftwareInput { port sensorPacket : MeasuredAttitude; }
    part def AttitudeEstimator { port reconstructedAttitude : MeasuredAttitude; }
    part selectedMission {
        part dynamics : Dynamics42;
        part starTracker : StarTrackerSimulator;
        part uart : NosEngineUart;
        part ingest : FlightSoftwareInput;
        part estimator : AttitudeEstimator;
    }
    requirement def CorrectFrameComposition {
        doc /* R-FRAME: Apply sensor mounting rotation once in the documented
               order. Check actual ADCS/GNC telemetry against an independent
               rotation-matrix oracle using noncommuting mounting and body rotations. */
    }
    requirement def SignEquivalence {
        doc /* R-SIGN: q and -q represent the same orientation through the live chain. */
    }
    requirement def MeasurementValidity {
        doc /* R-INVALID: Invalid sensor data must propagate to invalid AD/GNC output. */
    }
    requirement def SensorTruthSeparation {
        doc /* R-SENSOR-SEPARATION: Deliberately perturb the measured sensor
               attitude while preserving dynamics truth. Estimator output must
               follow the measurement. Truth may only serve as a reference. */
    }
    requirement frameContract : CorrectFrameComposition;
    requirement signContract : SignEquivalence;
    requirement validityContract : MeasurementValidity;
    requirement separationContract : SensorTruthSeparation;
    verification def LiveFrameRegression;
    verification def LiveSignRegression;
    verification def InvalidMeasurementRegression;
    verification def SensorBiasNegativeControl;
    doc /* Pending independently of this task: physical sensor and HIL,
           hard real-time qualification, all-device full-mission coverage,
           stale-measurement timeout. These are not established by a software run. */
}
