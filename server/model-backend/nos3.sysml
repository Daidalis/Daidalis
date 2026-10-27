package NOS3AttitudeInterface {
    private import ScalarValues::*;
    doc /* Manta component-level engineering model for NASA NOS3 generic_adcs.
           Reconstruct the sensor-to-body attitude interface from source evidence.
           This model does not claim to reproduce the complete NOS3/cFS/42 system. */

    attribute numericalTolerance : Real = 0.00000001;
    attribute rotationErrorToleranceRad : Real = 0.000001;

    attribute def Quaternion {
        attribute scalar : Real;
        attribute x : Real;
        attribute y : Real;
        attribute z : Real;
    }
    port def AttitudeMeasurement {
        attribute measurement : Quaternion;
    }
    part def StarTracker {
        attribute sensorFrameAttitude : Quaternion;
        attribute mountingRotation : Quaternion;
        port measuredAttitude : AttitudeMeasurement;
    }
    part def ADCS {
        port sensorInput : AttitudeMeasurement;
        attribute reconstructedBodyAttitude : Quaternion;
    }
    part def DynamicsTruth {
        attribute referenceAttitude : Quaternion;
        doc /* Reference-only oracle. It must not replace the measurement input. */
    }
    part attitudeChain {
        part sensor : StarTracker;
        part estimator : ADCS;
        part oracle : DynamicsTruth;
    }
    requirement def RotationComposition {
        doc /* R-ROTATION: source-backed quaternion composition must agree with an
               independent rotation-matrix oracle for identity, single-axis,
               and noncommuting combined rotations under the stated convention. */
    }
    requirement def QuaternionSignEquivalence {
        doc /* R-SIGN: q and -q must denote the same rotation. Compare orientation
               using rotation error, not component-wise quaternion equality. */
    }
    requirement def SensorTruthSeparation {
        doc /* R-SENSOR-SEPARATION: measured sensor input and dynamics truth are
               separate interfaces. Passing the math harness does not establish
               that the live flight-software ingest path uses the correct input. */
    }
    requirement compositionContract : RotationComposition;
    requirement signContract : QuaternionSignEquivalence;
    requirement inputContract : SensorTruthSeparation;

    verification def IndependentMatrixOracle {
        doc /* Fixed C harness calls upstream quaternion utilities; independently
               computes rotation matrices and compares vector-component residuals. Component
               verification only; telemetry and full integration remain untested. */
    }
    verification def FlightSoftwareInputPath {
        doc /* Required later: execute real star-tracker ingest and telemetry
               under NOS3/cFS/42. This verification case has not been executed. */
    }
    constraint def UnitQuaternion {
        in q0 : Real;
        in q1 : Real;
        in q2 : Real;
        in q3 : Real;
        q0*q0 + q1*q1 + q2*q2 + q3*q3 >= 0.99999999 and
        q0*q0 + q1*q1 + q2*q2 + q3*q3 <= 1.00000001
    }
}
