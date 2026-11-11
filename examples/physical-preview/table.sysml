package TableExample {
    private import SI::*;

    item def TableLeg :> ShapeItems::RectangularCuboid {
        attribute :>> length = 6 [cm];
        attribute :>> width = 6 [cm];
        attribute :>> height = 72 [cm];
    }

    part table {
        doc /* Dimensions are in centimetres. Z is up; the origin is on the floor
               below the centre of the tabletop. Each position is a solid centre. */

        item tabletop : ShapeItems::RectangularCuboid {
            attribute :>> length = 120 [cm];
            attribute :>> width = 70 [cm];
            attribute :>> height = 3 [cm];
            attribute centerX = 0 [cm];
            attribute centerY = 0 [cm];
            attribute centerZ = 73.5 [cm];
        }

        item frontLeftLeg : TableLeg {
            attribute centerX = -52 [cm];
            attribute centerY = -27 [cm];
            attribute centerZ = 36 [cm];
        }

        item frontRightLeg : TableLeg {
            attribute centerX = 52 [cm];
            attribute centerY = -27 [cm];
            attribute centerZ = 36 [cm];
        }

        item rearLeftLeg : TableLeg {
            attribute centerX = -52 [cm];
            attribute centerY = 27 [cm];
            attribute centerZ = 36 [cm];
        }

        item rearRightLeg : TableLeg {
            attribute centerX = 52 [cm];
            attribute centerY = 27 [cm];
            attribute centerZ = 36 [cm];
        }
    }
}
