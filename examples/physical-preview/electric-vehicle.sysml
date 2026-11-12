package ElectricVehicleExterior {
    private import SI::*;
    private import ScalarValues::*;

    doc /* 新能源汽车 — an illustrative electric sedan with 18-inch wheels.
           X points forward, Y left and Z up. Ground is Z = 0. The front bumper
           is at X = 2360 mm. Excluding mirrors, width is 1850 mm; deployed
           mirrors span 2089 mm. Length and height are 4720 and 1440 mm.
           Front/rear overhangs of 868/977 mm locate axle centers at 1492 and
           -1383 mm, a 2875 mm wheelbase. Track is 1584 mm on both axles.

           Nominal 235/45R18 tire radius = 18 * 25.4 / 2 + 235 * 0.45 = 334.35 mm.
           Axle heights use this unloaded radius. The paint, panel sections,
           lights, glass and wheel cover profiles are illustrative dimensions.
           Dimensional references are linked in the project README.

           battery, inverter and motor sit inside that envelope. Their names
           match the columns of the sibling electric-vehicle-drive.csv, loaded
           through electric-vehicle.recorded.json. That curve is a 60 s
           pull-away from VehicleDrive.mo, not an FMI run of this SysML file. */


    item def RoadTyre :> ShapeItems::RightCircularCylinder {
        attribute :>> radius = 334.35 [mm]; attribute :>> height = 235 [mm];
        attribute axis : String = "Y"; attribute color : String = "#25292C";
    }

    item def AlloyFace :> ShapeItems::RightCircularCylinder {
        attribute :>> radius = 228.6 [mm]; attribute :>> height = 7 [mm];
        attribute axis : String = "Y"; attribute color : String = "#A6AEB2";
    }

    item def AeroInset :> ShapeItems::RightCircularCylinder {
        attribute :>> radius = 200 [mm]; attribute :>> height = 8 [mm];
        attribute axis : String = "Y"; attribute color : String = "#394047";
    }

    item def CenterCap :> ShapeItems::RightCircularCylinder {
        attribute :>> radius = 39 [mm]; attribute :>> height = 12 [mm];
        attribute axis : String = "Y"; attribute color : String = "#858E93";
    }

    part def WheelCover {

        item rim : AlloyFace {
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
        }

        item inset : AeroInset {
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
        }

        item blade1 {
            attribute shape : String = "loft"; attribute color : String = "#869299";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item section1 {
                attribute x = 34.533 [mm]; attribute lowerZ = -0.433 [mm]; attribute upperZ = 1.242 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section2 {
                attribute x = 48.672 [mm]; attribute lowerZ = 2.396 [mm]; attribute upperZ = 37.895 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section3 {
                attribute x = 160.203 [mm]; attribute lowerZ = 24.715 [mm]; attribute upperZ = 75.023 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section4 {
                attribute x = 180.56 [mm]; attribute lowerZ = 40.301 [mm]; attribute upperZ = 81.8 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section5 {
                attribute x = 202.445 [mm]; attribute lowerZ = 57.058 [mm]; attribute upperZ = 58.344 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
        }

        item blade2 {
            attribute shape : String = "loft"; attribute color : String = "#869299";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item section1 {
                attribute x = -21.3 [mm]; attribute lowerZ = 99.7 [mm]; attribute upperZ = 197.327 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section2 {
                attribute x = -21 [mm]; attribute lowerZ = 58 [mm]; attribute upperZ = 197.467 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section3 {
                attribute x = 8 [mm]; attribute lowerZ = 34.437 [mm]; attribute upperZ = 211 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section4 {
                attribute x = 11 [mm]; attribute lowerZ = 32 [mm]; attribute upperZ = 202.5 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section5 {
                attribute x = 25.3 [mm]; attribute lowerZ = 154.027 [mm]; attribute upperZ = 161.983 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
        }

        item blade3 {
            attribute shape : String = "loft"; attribute color : String = "#869299";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item section1 {
                attribute x = -197.501 [mm]; attribute lowerZ = 67.124 [mm]; attribute upperZ = 72.829 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section2 {
                attribute x = -194.157 [mm]; attribute lowerZ = 39.953 [mm]; attribute upperZ = 72.913 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section3 {
                attribute x = -144.135 [mm]; attribute lowerZ = 24.097 [mm]; attribute upperZ = 74.17 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section4 {
                attribute x = -61.651 [mm]; attribute lowerZ = -2.049 [mm]; attribute upperZ = 36.26 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section5 {
                attribute x = -27.735 [mm]; attribute lowerZ = 19.897 [mm]; attribute upperZ = 20.672 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
        }

        item blade4 {
            attribute shape : String = "loft"; attribute color : String = "#869299";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item section1 {
                attribute x = -129.795 [mm]; attribute lowerZ = -166.136 [mm]; attribute upperZ = -163.646 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section2 {
                attribute x = -115.08 [mm]; attribute lowerZ = -168.992 [mm]; attribute upperZ = -114.16 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section3 {
                attribute x = -97.995 [mm]; attribute lowerZ = -172.308 [mm]; attribute upperZ = -95.635 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section4 {
                attribute x = -27.708 [mm]; attribute lowerZ = -74.088 [mm]; attribute upperZ = -19.423 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section5 {
                attribute x = -17.802 [mm]; attribute lowerZ = -60.245 [mm]; attribute upperZ = -56.637 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
        }

        item blade5 {
            attribute shape : String = "loft"; attribute color : String = "#869299";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item section1 {
                attribute x = 10.61 [mm]; attribute lowerZ = -33.601 [mm]; attribute upperZ = -32.392 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section2 {
                attribute x = 51.081 [mm]; attribute lowerZ = -105.672 [mm]; attribute upperZ = -34.579 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section3 {
                attribute x = 73.011 [mm]; attribute lowerZ = -144.725 [mm]; attribute upperZ = -64.312 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section4 {
                attribute x = 117.551 [mm]; attribute lowerZ = -175.405 [mm]; attribute upperZ = -124.697 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
            item section5 {
                attribute x = 132.892 [mm]; attribute lowerZ = -147.709 [mm]; attribute upperZ = -145.496 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 10 [mm];
            }
        }

        item hub : CenterCap {
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
        }

    }

    port def PowerPort {
        out attribute value : Real;
    }

    part def BatteryPack :> ShapeItems::RectangularCuboid {
        doc /* Floor pack inside the body envelope. Recorded column battery is state of charge, percent. */
        port output : PowerPort;
        attribute :>> length = 1600 [mm];
        attribute :>> width = 1100 [mm];
        attribute :>> height = 140 [mm];
        attribute color : String = "#1F4B3A";
    }

    part def Inverter :> ShapeItems::RectangularCuboid {
        doc /* Front power electronics. Recorded column inverter is output power, kilowatts. */
        port input : PowerPort;
        port output : PowerPort;
        attribute :>> length = 260 [mm];
        attribute :>> width = 180 [mm];
        attribute :>> height = 70 [mm];
        attribute color : String = "#C4A15A";
    }

    part def DriveMotor :> ShapeItems::RightCircularCylinder {
        doc /* Front drive unit, axis along Y. Recorded column motor is road speed, km/h. */
        port input : PowerPort;
        attribute :>> radius = 90 [mm];
        attribute :>> height = 220 [mm];
        attribute axis : String = "Y";
        attribute color : String = "#4C5560";
    }

    part '新能源汽车' {

        item bodyShell {
            doc /* Illustrative red outer skin. Raised lower edges at both axles form wheel openings. Cross sections and finish are approximate. */
            attribute shape : String = "loft"; attribute color : String = "#AC2339";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearFace {
                attribute x = -2360 [mm]; attribute lowerZ = 406 [mm]; attribute upperZ = 810 [mm];
                attribute lowerWidth = 1250 [mm]; attribute upperWidth = 1420 [mm]; attribute shoulderZ = 677 [mm];
                attribute shoulderWidth = 1510 [mm];
            }
            item rearLip {
                attribute x = -2280 [mm]; attribute lowerZ = 310 [mm]; attribute upperZ = 921 [mm];
                attribute lowerWidth = 1510 [mm]; attribute upperWidth = 1510 [mm]; attribute shoulderZ = 754 [mm];
                attribute shoulderWidth = 1690 [mm];
            }
            item rearBumper {
                attribute x = -2080 [mm]; attribute lowerZ = 235 [mm]; attribute upperZ = 949 [mm];
                attribute lowerWidth = 1590 [mm]; attribute upperWidth = 1560 [mm]; attribute shoulderZ = 774 [mm];
                attribute shoulderWidth = 1770 [mm];
            }
            item rearSkirt {
                attribute x = -1770 [mm]; attribute lowerZ = 198 [mm]; attribute upperZ = 950 [mm];
                attribute lowerWidth = 1620 [mm]; attribute upperWidth = 1580 [mm]; attribute shoulderZ = 788 [mm];
                attribute shoulderWidth = 1815 [mm];
            }
            item rearArchEdge {
                attribute x = -1741 [mm]; attribute lowerZ = 345 [mm]; attribute upperZ = 945 [mm];
                attribute lowerWidth = 1768 [mm]; attribute upperWidth = 1590 [mm]; attribute shoulderZ = 795 [mm];
                attribute shoulderWidth = 1832 [mm];
            }
            item rearArchA {
                attribute x = -1701 [mm]; attribute lowerZ = 508 [mm]; attribute upperZ = 943 [mm];
                attribute lowerWidth = 1785 [mm]; attribute upperWidth = 1594 [mm]; attribute shoulderZ = 797 [mm];
                attribute shoulderWidth = 1835 [mm];
            }
            item rearArchB {
                attribute x = -1614 [mm]; attribute lowerZ = 613 [mm]; attribute upperZ = 940 [mm];
                attribute lowerWidth = 1800 [mm]; attribute upperWidth = 1600 [mm]; attribute shoulderZ = 800 [mm];
                attribute shoulderWidth = 1841 [mm];
            }
            item rearArchC {
                attribute x = -1505 [mm]; attribute lowerZ = 673 [mm]; attribute upperZ = 938 [mm];
                attribute lowerWidth = 1814 [mm]; attribute upperWidth = 1608 [mm]; attribute shoulderZ = 800 [mm];
                attribute shoulderWidth = 1847 [mm];
            }
            item rearArchCrown {
                attribute x = -1383 [mm]; attribute lowerZ = 696 [mm]; attribute upperZ = 936 [mm];
                attribute lowerWidth = 1816 [mm]; attribute upperWidth = 1618 [mm]; attribute shoulderZ = 800 [mm];
                attribute shoulderWidth = 1850 [mm];
            }
            item rearArchD {
                attribute x = -1261 [mm]; attribute lowerZ = 673 [mm]; attribute upperZ = 934 [mm];
                attribute lowerWidth = 1814 [mm]; attribute upperWidth = 1620 [mm]; attribute shoulderZ = 798 [mm];
                attribute shoulderWidth = 1848 [mm];
            }
            item rearArchE {
                attribute x = -1152 [mm]; attribute lowerZ = 613 [mm]; attribute upperZ = 932 [mm];
                attribute lowerWidth = 1800 [mm]; attribute upperWidth = 1620 [mm]; attribute shoulderZ = 797 [mm];
                attribute shoulderWidth = 1845 [mm];
            }
            item rearArchF {
                attribute x = -1065 [mm]; attribute lowerZ = 508 [mm]; attribute upperZ = 930 [mm];
                attribute lowerWidth = 1785 [mm]; attribute upperWidth = 1616 [mm]; attribute shoulderZ = 795 [mm];
                attribute shoulderWidth = 1837 [mm];
            }
            item rearArchExit {
                attribute x = -1025 [mm]; attribute lowerZ = 345 [mm]; attribute upperZ = 928 [mm];
                attribute lowerWidth = 1768 [mm]; attribute upperWidth = 1614 [mm]; attribute shoulderZ = 792 [mm];
                attribute shoulderWidth = 1832 [mm];
            }
            item rearSill {
                attribute x = -1001 [mm]; attribute lowerZ = 180 [mm]; attribute upperZ = 925 [mm];
                attribute lowerWidth = 1710 [mm]; attribute upperWidth = 1610 [mm]; attribute shoulderZ = 785 [mm];
                attribute shoulderWidth = 1830 [mm];
            }
            item sillCenter {
                attribute x = 0 [mm]; attribute lowerZ = 171 [mm]; attribute upperZ = 900 [mm];
                attribute lowerWidth = 1704 [mm]; attribute upperWidth = 1600 [mm]; attribute shoulderZ = 762 [mm];
                attribute shoulderWidth = 1826 [mm];
            }
            item frontSill {
                attribute x = 1111 [mm]; attribute lowerZ = 183 [mm]; attribute upperZ = 856 [mm];
                attribute lowerWidth = 1710 [mm]; attribute upperWidth = 1540 [mm]; attribute shoulderZ = 740 [mm];
                attribute shoulderWidth = 1826 [mm];
            }
            item frontArchEdge {
                attribute x = 1134 [mm]; attribute lowerZ = 345 [mm]; attribute upperZ = 855 [mm];
                attribute lowerWidth = 1768 [mm]; attribute upperWidth = 1535 [mm]; attribute shoulderZ = 759 [mm];
                attribute shoulderWidth = 1833 [mm];
            }
            item frontArchA {
                attribute x = 1174 [mm]; attribute lowerZ = 508 [mm]; attribute upperZ = 851 [mm];
                attribute lowerWidth = 1785 [mm]; attribute upperWidth = 1525 [mm]; attribute shoulderZ = 767 [mm];
                attribute shoulderWidth = 1837 [mm];
            }
            item frontArchB {
                attribute x = 1261 [mm]; attribute lowerZ = 613 [mm]; attribute upperZ = 842 [mm];
                attribute lowerWidth = 1798 [mm]; attribute upperWidth = 1510 [mm]; attribute shoulderZ = 766 [mm];
                attribute shoulderWidth = 1843 [mm];
            }
            item frontArchC {
                attribute x = 1370 [mm]; attribute lowerZ = 673 [mm]; attribute upperZ = 832 [mm];
                attribute lowerWidth = 1810 [mm]; attribute upperWidth = 1490 [mm]; attribute shoulderZ = 765 [mm];
                attribute shoulderWidth = 1848 [mm];
            }
            item frontArchCrown {
                attribute x = 1492 [mm]; attribute lowerZ = 696 [mm]; attribute upperZ = 816 [mm];
                attribute lowerWidth = 1816 [mm]; attribute upperWidth = 1460 [mm]; attribute shoulderZ = 759 [mm];
                attribute shoulderWidth = 1850 [mm];
            }
            item frontArchD {
                attribute x = 1614 [mm]; attribute lowerZ = 673 [mm]; attribute upperZ = 800 [mm];
                attribute lowerWidth = 1812 [mm]; attribute upperWidth = 1430 [mm]; attribute shoulderZ = 744 [mm];
                attribute shoulderWidth = 1848 [mm];
            }
            item frontArchE {
                attribute x = 1723 [mm]; attribute lowerZ = 613 [mm]; attribute upperZ = 782 [mm];
                attribute lowerWidth = 1800 [mm]; attribute upperWidth = 1400 [mm]; attribute shoulderZ = 725 [mm];
                attribute shoulderWidth = 1843 [mm];
            }
            item frontArchF {
                attribute x = 1810 [mm]; attribute lowerZ = 508 [mm]; attribute upperZ = 760 [mm];
                attribute lowerWidth = 1785 [mm]; attribute upperWidth = 1374 [mm]; attribute shoulderZ = 706 [mm];
                attribute shoulderWidth = 1834 [mm];
            }
            item frontArchExit {
                attribute x = 1850 [mm]; attribute lowerZ = 345 [mm]; attribute upperZ = 751 [mm];
                attribute lowerWidth = 1768 [mm]; attribute upperWidth = 1360 [mm]; attribute shoulderZ = 684 [mm];
                attribute shoulderWidth = 1828 [mm];
            }
            item frontValance {
                attribute x = 1882 [mm]; attribute lowerZ = 210 [mm]; attribute upperZ = 741 [mm];
                attribute lowerWidth = 1630 [mm]; attribute upperWidth = 1340 [mm]; attribute shoulderZ = 655 [mm];
                attribute shoulderWidth = 1817 [mm];
            }
            item headlightLine {
                attribute x = 2150 [mm]; attribute lowerZ = 245 [mm]; attribute upperZ = 637 [mm];
                attribute lowerWidth = 1520 [mm]; attribute upperWidth = 1330 [mm]; attribute shoulderZ = 554 [mm];
                attribute shoulderWidth = 1730 [mm];
            }
            item nose {
                attribute x = 2308 [mm]; attribute lowerZ = 278 [mm]; attribute upperZ = 545 [mm];
                attribute lowerWidth = 1410 [mm]; attribute upperWidth = 1290 [mm]; attribute shoulderZ = 469 [mm];
                attribute shoulderWidth = 1620 [mm];
            }
            item frontFace {
                attribute x = 2360 [mm]; attribute lowerZ = 383 [mm]; attribute upperZ = 420 [mm];
                attribute lowerWidth = 1210 [mm]; attribute upperWidth = 1250 [mm]; attribute shoulderZ = 404 [mm];
                attribute shoulderWidth = 1380 [mm];
            }
        }

        item panoramicGlass {
            doc /* Combined glazing envelope. The roof crown sets the specified 1440 mm vehicle height. */
            attribute shape : String = "loft"; attribute color : String = "#344752";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 921 [mm]; attribute upperZ = 948 [mm];
                attribute lowerWidth = 1450 [mm]; attribute upperWidth = 1370 [mm]; attribute shoulderZ = 936 [mm];
                attribute shoulderWidth = 1430 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 927 [mm]; attribute upperZ = 1078 [mm];
                attribute lowerWidth = 1520 [mm]; attribute upperWidth = 1270 [mm]; attribute shoulderZ = 1045 [mm];
                attribute shoulderWidth = 1360 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 930 [mm]; attribute upperZ = 1234 [mm];
                attribute lowerWidth = 1566 [mm]; attribute upperWidth = 1200 [mm]; attribute shoulderZ = 1182 [mm];
                attribute shoulderWidth = 1350 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 925 [mm]; attribute upperZ = 1358 [mm];
                attribute lowerWidth = 1590 [mm]; attribute upperWidth = 1150 [mm]; attribute shoulderZ = 1292 [mm];
                attribute shoulderWidth = 1354 [mm];
            }
            item roofArc {
                attribute x = -470 [mm]; attribute lowerZ = 920 [mm]; attribute upperZ = 1420 [mm];
                attribute lowerWidth = 1606 [mm]; attribute upperWidth = 1120 [mm]; attribute shoulderZ = 1356 [mm];
                attribute shoulderWidth = 1360 [mm];
            }
            item roofCrown {
                attribute x = -180 [mm]; attribute lowerZ = 914 [mm]; attribute upperZ = 1440 [mm];
                attribute lowerWidth = 1612 [mm]; attribute upperWidth = 1100 [mm]; attribute shoulderZ = 1369 [mm];
                attribute shoulderWidth = 1364 [mm];
            }
            item roofFront {
                attribute x = 80 [mm]; attribute lowerZ = 906 [mm]; attribute upperZ = 1426 [mm];
                attribute lowerWidth = 1610 [mm]; attribute upperWidth = 1108 [mm]; attribute shoulderZ = 1362 [mm];
                attribute shoulderWidth = 1362 [mm];
            }
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 894 [mm]; attribute upperZ = 1365 [mm];
                attribute lowerWidth = 1604 [mm]; attribute upperWidth = 1140 [mm]; attribute shoulderZ = 1313 [mm];
                attribute shoulderWidth = 1360 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 883 [mm]; attribute upperZ = 1204 [mm];
                attribute lowerWidth = 1590 [mm]; attribute upperWidth = 1190 [mm]; attribute shoulderZ = 1176 [mm];
                attribute shoulderWidth = 1384 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 862 [mm]; attribute upperZ = 992 [mm];
                attribute lowerWidth = 1550 [mm]; attribute upperWidth = 1320 [mm]; attribute shoulderZ = 974 [mm];
                attribute shoulderWidth = 1440 [mm];
            }
            item windshieldFoot {
                attribute x = 1036 [mm]; attribute lowerZ = 851 [mm]; attribute upperZ = 866 [mm];
                attribute lowerWidth = 1510 [mm]; attribute upperWidth = 1460 [mm]; attribute shoulderZ = 861 [mm];
                attribute shoulderWidth = 1496 [mm];
            }
        }

        item underfloor {
            doc /* Simplified underfloor envelope; the lowest point uses the published ground clearance. */
            attribute shape : String = "loft"; attribute color : String = "#292E32";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -2025 [mm]; attribute lowerZ = 222 [mm]; attribute upperZ = 649 [mm];
                attribute lowerWidth = 1290 [mm]; attribute upperWidth = 1320 [mm];
            }
            item centerFloor {
                attribute x = 0 [mm]; attribute lowerZ = 138 [mm]; attribute upperZ = 706 [mm];
                attribute lowerWidth = 1340 [mm]; attribute upperWidth = 1380 [mm];
            }
            item fore {
                attribute x = 2070 [mm]; attribute lowerZ = 253 [mm]; attribute upperZ = 586 [mm];
                attribute lowerWidth = 1230 [mm]; attribute upperWidth = 1270 [mm];
            }
        }

        item lowerFrontIntake {
            attribute shape : String = "loft"; attribute color : String = "#252B30";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item back {
                attribute x = 2265 [mm]; attribute lowerZ = 279 [mm]; attribute upperZ = 328 [mm];
                attribute lowerWidth = 1160 [mm]; attribute upperWidth = 1110 [mm];
            }
            item lip {
                attribute x = 2316 [mm]; attribute lowerZ = 298 [mm]; attribute upperZ = 348 [mm];
                attribute lowerWidth = 1135 [mm]; attribute upperWidth = 1070 [mm];
            }
            item face {
                attribute x = 2345 [mm]; attribute lowerZ = 333 [mm]; attribute upperZ = 371 [mm];
                attribute lowerWidth = 985 [mm]; attribute upperWidth = 918 [mm];
            }
            item edge {
                attribute x = 2356 [mm]; attribute lowerZ = 364 [mm]; attribute upperZ = 385 [mm];
                attribute lowerWidth = 904 [mm]; attribute upperWidth = 876 [mm];
            }
        }

        item mirrorStalkLeft {
            attribute shape : String = "loft"; attribute color : String = "#252C30";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item base {
                attribute x = 540 [mm]; attribute lowerZ = 953 [mm]; attribute upperZ = 984 [mm];
                attribute lowerWidth = 84 [mm]; attribute upperWidth = 70 [mm]; attribute y = 820 [mm];
            }
            item tip {
                attribute x = 710 [mm]; attribute lowerZ = 978 [mm]; attribute upperZ = 1012 [mm];
                attribute lowerWidth = 58 [mm]; attribute upperWidth = 48 [mm]; attribute y = 947 [mm];
            }
        }

        item mirrorCapLeft {
            attribute shape : String = "loft"; attribute color : String = "#AC2339";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = 528 [mm]; attribute lowerZ = 989 [mm]; attribute upperZ = 1036 [mm];
                attribute lowerWidth = 95 [mm]; attribute upperWidth = 84 [mm]; attribute y = 958 [mm];
            }
            item middle {
                attribute x = 604 [mm]; attribute lowerZ = 982 [mm]; attribute upperZ = 1083 [mm];
                attribute lowerWidth = 183 [mm]; attribute upperWidth = 124 [mm]; attribute y = 953 [mm];
            }
            item fore {
                attribute x = 730 [mm]; attribute lowerZ = 1000 [mm]; attribute upperZ = 1057 [mm];
                attribute lowerWidth = 140 [mm]; attribute upperWidth = 93 [mm]; attribute y = 936 [mm];
            }
        }

        item frontLampLeft {
            attribute shape : String = "loft"; attribute color : String = "#202A31";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item outerTip {
                attribute x = 1990 [mm]; attribute lowerZ = 626.159 [mm]; attribute upperZ = 636.159 [mm];
                attribute lowerWidth = 24 [mm]; attribute upperWidth = 24 [mm]; attribute y = 844 [mm];
            }
            item sweep {
                attribute x = 2110 [mm]; attribute lowerZ = 592.882 [mm]; attribute upperZ = 602.882 [mm];
                attribute lowerWidth = 92 [mm]; attribute upperWidth = 76 [mm]; attribute y = 798 [mm];
            }
            item innerTip {
                attribute x = 2245 [mm]; attribute lowerZ = 575.684 [mm]; attribute upperZ = 585.684 [mm];
                attribute lowerWidth = 82 [mm]; attribute upperWidth = 68 [mm]; attribute y = 640 [mm];
            }
            item frontTip {
                attribute x = 2294 [mm]; attribute lowerZ = 547.152 [mm]; attribute upperZ = 557.152 [mm];
                attribute lowerWidth = 23 [mm]; attribute upperWidth = 19 [mm]; attribute y = 526 [mm];
            }
        }

        item daylightStripLeft {
            attribute shape : String = "loft"; attribute color : String = "#E6F2F6";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item outerTip {
                attribute x = 1995 [mm]; attribute lowerZ = 632.011 [mm]; attribute upperZ = 636.011 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 11 [mm]; attribute y = 844 [mm];
            }
            item sweep {
                attribute x = 2110 [mm]; attribute lowerZ = 600.477 [mm]; attribute upperZ = 604.477 [mm];
                attribute lowerWidth = 30 [mm]; attribute upperWidth = 24 [mm]; attribute y = 799 [mm];
            }
            item innerTip {
                attribute x = 2245 [mm]; attribute lowerZ = 583.684 [mm]; attribute upperZ = 587.684 [mm];
                attribute lowerWidth = 30 [mm]; attribute upperWidth = 24 [mm]; attribute y = 640 [mm];
            }
            item frontTip {
                attribute x = 2289 [mm]; attribute lowerZ = 558.063 [mm]; attribute upperZ = 562.063 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 11 [mm]; attribute y = 536 [mm];
            }
        }

        item tailLampLeft {
            attribute shape : String = "loft"; attribute color : String = "#641526";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -2358 [mm]; attribute lowerZ = 756 [mm]; attribute upperZ = 789 [mm];
                attribute lowerWidth = 165 [mm]; attribute upperWidth = 156 [mm]; attribute y = 625 [mm];
            }
            item back {
                attribute x = -2294 [mm]; attribute lowerZ = 830 [mm]; attribute upperZ = 866 [mm];
                attribute lowerWidth = 195 [mm]; attribute upperWidth = 178 [mm]; attribute y = 701 [mm];
            }
            item wrap {
                attribute x = -2082 [mm]; attribute lowerZ = 865 [mm]; attribute upperZ = 896 [mm];
                attribute lowerWidth = 84 [mm]; attribute upperWidth = 62 [mm]; attribute y = 840 [mm];
            }
            item tip {
                attribute x = -1995 [mm]; attribute lowerZ = 876 [mm]; attribute upperZ = 890 [mm];
                attribute lowerWidth = 25 [mm]; attribute upperWidth = 20 [mm]; attribute y = 851 [mm];
            }
        }

        item rearSignatureLeft {
            attribute shape : String = "loft"; attribute color : String = "#EF3545";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -2359 [mm]; attribute lowerZ = 778 [mm]; attribute upperZ = 787 [mm];
                attribute lowerWidth = 142 [mm]; attribute upperWidth = 128 [mm]; attribute y = 625 [mm];
            }
            item back {
                attribute x = -2294 [mm]; attribute lowerZ = 854 [mm]; attribute upperZ = 865 [mm];
                attribute lowerWidth = 160 [mm]; attribute upperWidth = 150 [mm]; attribute y = 709 [mm];
            }
            item wrap {
                attribute x = -2082 [mm]; attribute lowerZ = 884 [mm]; attribute upperZ = 895 [mm];
                attribute lowerWidth = 45 [mm]; attribute upperWidth = 40 [mm]; attribute y = 855 [mm];
            }
        }

        item frontDoorLeadingLeft {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = 834 [mm]; attribute lowerZ = 838 [mm]; attribute upperZ = 854 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 802.673 [mm];
            }
            item line2 {
                attribute x = 861 [mm]; attribute lowerZ = 724 [mm]; attribute upperZ = 740 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 913.454 [mm];
            }
            item line3 {
                attribute x = 923 [mm]; attribute lowerZ = 460 [mm]; attribute upperZ = 476 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 886.134 [mm];
            }
            item line4 {
                attribute x = 938 [mm]; attribute lowerZ = 217 [mm]; attribute upperZ = 233 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 860.894 [mm];
            }
        }

        item middleDoorJointLeft {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = -288 [mm]; attribute lowerZ = 884 [mm]; attribute upperZ = 900 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 815.533 [mm];
            }
            item line2 {
                attribute x = -260 [mm]; attribute lowerZ = 753 [mm]; attribute upperZ = 769 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 914.607 [mm];
            }
            item line3 {
                attribute x = -235 [mm]; attribute lowerZ = 407 [mm]; attribute upperZ = 423 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 879.237 [mm];
            }
            item line4 {
                attribute x = -221 [mm]; attribute lowerZ = 213 [mm]; attribute upperZ = 229 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 859.374 [mm];
            }
        }

        item rearDoorTrailingLeft {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = -1186 [mm]; attribute lowerZ = 899 [mm]; attribute upperZ = 915 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 833.193 [mm];
            }
            item line2 {
                attribute x = -1157 [mm]; attribute lowerZ = 791 [mm]; attribute upperZ = 807 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 922.74 [mm];
            }
            item line3 {
                attribute x = -1097 [mm]; attribute lowerZ = 677 [mm]; attribute upperZ = 693 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 910.786 [mm];
            }
            item line4 {
                attribute x = -1032 [mm]; attribute lowerZ = 566 [mm]; attribute upperZ = 582 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 902.096 [mm];
            }
            item line5 {
                attribute x = -990 [mm]; attribute lowerZ = 445 [mm]; attribute upperZ = 461 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 883.863 [mm];
            }
            item line6 {
                attribute x = -921 [mm]; attribute lowerZ = 229 [mm]; attribute upperZ = 245 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = 862.303 [mm];
            }
        }

        item roofRailLeft {
            attribute shape : String = "loft"; attribute color : String = "#9B2233";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 929 [mm]; attribute upperZ = 941 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 716 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 1038 [mm]; attribute upperZ = 1050 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 681 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 1175 [mm]; attribute upperZ = 1187 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 676 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 1285 [mm]; attribute upperZ = 1297 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 678 [mm];
            }
            item roofArc {
                attribute x = -470 [mm]; attribute lowerZ = 1349 [mm]; attribute upperZ = 1361 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 681 [mm];
            }
            item roofCrown {
                attribute x = -180 [mm]; attribute lowerZ = 1362 [mm]; attribute upperZ = 1374 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 683 [mm];
            }
            item roofFront {
                attribute x = 80 [mm]; attribute lowerZ = 1355 [mm]; attribute upperZ = 1367 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 682 [mm];
            }
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 1306 [mm]; attribute upperZ = 1318 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 681 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 1169 [mm]; attribute upperZ = 1181 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 693 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 967 [mm]; attribute upperZ = 979 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 721 [mm];
            }
            item windshieldFoot {
                attribute x = 1036 [mm]; attribute lowerZ = 854 [mm]; attribute upperZ = 866 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 749 [mm];
            }
        }

        item bPillarLeft {
            attribute shape : String = "loft"; attribute color : String = "#171E24";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item base {
                attribute x = -257 [mm]; attribute lowerZ = 914 [mm]; attribute upperZ = 926 [mm];
                attribute lowerWidth = 32 [mm]; attribute upperWidth = 32 [mm]; attribute y = 803 [mm];
            }
            item middle {
                attribute x = -227 [mm]; attribute lowerZ = 1090 [mm]; attribute upperZ = 1181 [mm];
                attribute lowerWidth = 25 [mm]; attribute upperWidth = 25 [mm]; attribute y = 754 [mm];
            }
            item top {
                attribute x = -170 [mm]; attribute lowerZ = 1325 [mm]; attribute upperZ = 1372 [mm];
                attribute lowerWidth = 19 [mm]; attribute upperWidth = 18 [mm]; attribute y = 686 [mm];
            }
        }

        item frontHandleLeft {
            attribute shape : String = "loft"; attribute color : String = "#41464B";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -53 [mm]; attribute lowerZ = 774 [mm]; attribute upperZ = 783 [mm];
                attribute lowerWidth = 16 [mm]; attribute upperWidth = 14 [mm]; attribute y = 906 [mm];
            }
            item grip {
                attribute x = -24 [mm]; attribute lowerZ = 770 [mm]; attribute upperZ = 786 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 907 [mm];
            }
            item fore {
                attribute x = 69 [mm]; attribute lowerZ = 775 [mm]; attribute upperZ = 783 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 12 [mm]; attribute y = 906 [mm];
            }
        }

        item rearHandleLeft {
            attribute shape : String = "loft"; attribute color : String = "#41464B";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -919 [mm]; attribute lowerZ = 800 [mm]; attribute upperZ = 809 [mm];
                attribute lowerWidth = 16 [mm]; attribute upperWidth = 14 [mm]; attribute y = 906 [mm];
            }
            item grip {
                attribute x = -890 [mm]; attribute lowerZ = 796 [mm]; attribute upperZ = 812 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = 907 [mm];
            }
            item fore {
                attribute x = -797 [mm]; attribute lowerZ = 801 [mm]; attribute upperZ = 809 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 12 [mm]; attribute y = 906 [mm];
            }
        }

        item mirrorStalkRight {
            attribute shape : String = "loft"; attribute color : String = "#252C30";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item base {
                attribute x = 540 [mm]; attribute lowerZ = 953 [mm]; attribute upperZ = 984 [mm];
                attribute lowerWidth = 84 [mm]; attribute upperWidth = 70 [mm]; attribute y = -820 [mm];
            }
            item tip {
                attribute x = 710 [mm]; attribute lowerZ = 978 [mm]; attribute upperZ = 1012 [mm];
                attribute lowerWidth = 58 [mm]; attribute upperWidth = 48 [mm]; attribute y = -947 [mm];
            }
        }

        item mirrorCapRight {
            attribute shape : String = "loft"; attribute color : String = "#AC2339";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = 528 [mm]; attribute lowerZ = 989 [mm]; attribute upperZ = 1036 [mm];
                attribute lowerWidth = 95 [mm]; attribute upperWidth = 84 [mm]; attribute y = -958 [mm];
            }
            item middle {
                attribute x = 604 [mm]; attribute lowerZ = 982 [mm]; attribute upperZ = 1083 [mm];
                attribute lowerWidth = 183 [mm]; attribute upperWidth = 124 [mm]; attribute y = -953 [mm];
            }
            item fore {
                attribute x = 730 [mm]; attribute lowerZ = 1000 [mm]; attribute upperZ = 1057 [mm];
                attribute lowerWidth = 140 [mm]; attribute upperWidth = 93 [mm]; attribute y = -936 [mm];
            }
        }

        item frontLampRight {
            attribute shape : String = "loft"; attribute color : String = "#202A31";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item outerTip {
                attribute x = 1990 [mm]; attribute lowerZ = 626.159 [mm]; attribute upperZ = 636.159 [mm];
                attribute lowerWidth = 24 [mm]; attribute upperWidth = 24 [mm]; attribute y = -844 [mm];
            }
            item sweep {
                attribute x = 2110 [mm]; attribute lowerZ = 592.882 [mm]; attribute upperZ = 602.882 [mm];
                attribute lowerWidth = 92 [mm]; attribute upperWidth = 76 [mm]; attribute y = -798 [mm];
            }
            item innerTip {
                attribute x = 2245 [mm]; attribute lowerZ = 575.684 [mm]; attribute upperZ = 585.684 [mm];
                attribute lowerWidth = 82 [mm]; attribute upperWidth = 68 [mm]; attribute y = -640 [mm];
            }
            item frontTip {
                attribute x = 2294 [mm]; attribute lowerZ = 547.152 [mm]; attribute upperZ = 557.152 [mm];
                attribute lowerWidth = 23 [mm]; attribute upperWidth = 19 [mm]; attribute y = -526 [mm];
            }
        }

        item daylightStripRight {
            attribute shape : String = "loft"; attribute color : String = "#E6F2F6";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item outerTip {
                attribute x = 1995 [mm]; attribute lowerZ = 632.011 [mm]; attribute upperZ = 636.011 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 11 [mm]; attribute y = -844 [mm];
            }
            item sweep {
                attribute x = 2110 [mm]; attribute lowerZ = 600.477 [mm]; attribute upperZ = 604.477 [mm];
                attribute lowerWidth = 30 [mm]; attribute upperWidth = 24 [mm]; attribute y = -799 [mm];
            }
            item innerTip {
                attribute x = 2245 [mm]; attribute lowerZ = 583.684 [mm]; attribute upperZ = 587.684 [mm];
                attribute lowerWidth = 30 [mm]; attribute upperWidth = 24 [mm]; attribute y = -640 [mm];
            }
            item frontTip {
                attribute x = 2289 [mm]; attribute lowerZ = 558.063 [mm]; attribute upperZ = 562.063 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 11 [mm]; attribute y = -536 [mm];
            }
        }

        item tailLampRight {
            attribute shape : String = "loft"; attribute color : String = "#641526";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -2358 [mm]; attribute lowerZ = 756 [mm]; attribute upperZ = 789 [mm];
                attribute lowerWidth = 165 [mm]; attribute upperWidth = 156 [mm]; attribute y = -625 [mm];
            }
            item back {
                attribute x = -2294 [mm]; attribute lowerZ = 830 [mm]; attribute upperZ = 866 [mm];
                attribute lowerWidth = 195 [mm]; attribute upperWidth = 178 [mm]; attribute y = -701 [mm];
            }
            item wrap {
                attribute x = -2082 [mm]; attribute lowerZ = 865 [mm]; attribute upperZ = 896 [mm];
                attribute lowerWidth = 84 [mm]; attribute upperWidth = 62 [mm]; attribute y = -840 [mm];
            }
            item tip {
                attribute x = -1995 [mm]; attribute lowerZ = 876 [mm]; attribute upperZ = 890 [mm];
                attribute lowerWidth = 25 [mm]; attribute upperWidth = 20 [mm]; attribute y = -851 [mm];
            }
        }

        item rearSignatureRight {
            attribute shape : String = "loft"; attribute color : String = "#EF3545";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -2359 [mm]; attribute lowerZ = 778 [mm]; attribute upperZ = 787 [mm];
                attribute lowerWidth = 142 [mm]; attribute upperWidth = 128 [mm]; attribute y = -625 [mm];
            }
            item back {
                attribute x = -2294 [mm]; attribute lowerZ = 854 [mm]; attribute upperZ = 865 [mm];
                attribute lowerWidth = 160 [mm]; attribute upperWidth = 150 [mm]; attribute y = -709 [mm];
            }
            item wrap {
                attribute x = -2082 [mm]; attribute lowerZ = 884 [mm]; attribute upperZ = 895 [mm];
                attribute lowerWidth = 45 [mm]; attribute upperWidth = 40 [mm]; attribute y = -855 [mm];
            }
        }

        item frontDoorLeadingRight {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = 834 [mm]; attribute lowerZ = 838 [mm]; attribute upperZ = 854 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -802.673 [mm];
            }
            item line2 {
                attribute x = 861 [mm]; attribute lowerZ = 724 [mm]; attribute upperZ = 740 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -913.454 [mm];
            }
            item line3 {
                attribute x = 923 [mm]; attribute lowerZ = 460 [mm]; attribute upperZ = 476 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -886.134 [mm];
            }
            item line4 {
                attribute x = 938 [mm]; attribute lowerZ = 217 [mm]; attribute upperZ = 233 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -860.894 [mm];
            }
        }

        item middleDoorJointRight {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = -288 [mm]; attribute lowerZ = 884 [mm]; attribute upperZ = 900 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -815.533 [mm];
            }
            item line2 {
                attribute x = -260 [mm]; attribute lowerZ = 753 [mm]; attribute upperZ = 769 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -914.607 [mm];
            }
            item line3 {
                attribute x = -235 [mm]; attribute lowerZ = 407 [mm]; attribute upperZ = 423 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -879.237 [mm];
            }
            item line4 {
                attribute x = -221 [mm]; attribute lowerZ = 213 [mm]; attribute upperZ = 229 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -859.374 [mm];
            }
        }

        item rearDoorTrailingRight {
            attribute shape : String = "loft"; attribute color : String = "#722332";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item line1 {
                attribute x = -1186 [mm]; attribute lowerZ = 899 [mm]; attribute upperZ = 915 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -833.193 [mm];
            }
            item line2 {
                attribute x = -1157 [mm]; attribute lowerZ = 791 [mm]; attribute upperZ = 807 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -922.74 [mm];
            }
            item line3 {
                attribute x = -1097 [mm]; attribute lowerZ = 677 [mm]; attribute upperZ = 693 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -910.786 [mm];
            }
            item line4 {
                attribute x = -1032 [mm]; attribute lowerZ = 566 [mm]; attribute upperZ = 582 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -902.096 [mm];
            }
            item line5 {
                attribute x = -990 [mm]; attribute lowerZ = 445 [mm]; attribute upperZ = 461 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -883.863 [mm];
            }
            item line6 {
                attribute x = -921 [mm]; attribute lowerZ = 229 [mm]; attribute upperZ = 245 [mm];
                attribute lowerWidth = 4 [mm]; attribute upperWidth = 4 [mm]; attribute y = -862.303 [mm];
            }
        }

        item roofRailRight {
            attribute shape : String = "loft"; attribute color : String = "#9B2233";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 929 [mm]; attribute upperZ = 941 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -716 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 1038 [mm]; attribute upperZ = 1050 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -681 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 1175 [mm]; attribute upperZ = 1187 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -676 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 1285 [mm]; attribute upperZ = 1297 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -678 [mm];
            }
            item roofArc {
                attribute x = -470 [mm]; attribute lowerZ = 1349 [mm]; attribute upperZ = 1361 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -681 [mm];
            }
            item roofCrown {
                attribute x = -180 [mm]; attribute lowerZ = 1362 [mm]; attribute upperZ = 1374 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -683 [mm];
            }
            item roofFront {
                attribute x = 80 [mm]; attribute lowerZ = 1355 [mm]; attribute upperZ = 1367 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -682 [mm];
            }
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 1306 [mm]; attribute upperZ = 1318 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -681 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 1169 [mm]; attribute upperZ = 1181 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -693 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 967 [mm]; attribute upperZ = 979 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -721 [mm];
            }
            item windshieldFoot {
                attribute x = 1036 [mm]; attribute lowerZ = 854 [mm]; attribute upperZ = 866 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -749 [mm];
            }
        }

        item bPillarRight {
            attribute shape : String = "loft"; attribute color : String = "#171E24";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item base {
                attribute x = -257 [mm]; attribute lowerZ = 914 [mm]; attribute upperZ = 926 [mm];
                attribute lowerWidth = 32 [mm]; attribute upperWidth = 32 [mm]; attribute y = -803 [mm];
            }
            item middle {
                attribute x = -227 [mm]; attribute lowerZ = 1090 [mm]; attribute upperZ = 1181 [mm];
                attribute lowerWidth = 25 [mm]; attribute upperWidth = 25 [mm]; attribute y = -754 [mm];
            }
            item top {
                attribute x = -170 [mm]; attribute lowerZ = 1325 [mm]; attribute upperZ = 1372 [mm];
                attribute lowerWidth = 19 [mm]; attribute upperWidth = 18 [mm]; attribute y = -686 [mm];
            }
        }

        item frontHandleRight {
            attribute shape : String = "loft"; attribute color : String = "#41464B";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -53 [mm]; attribute lowerZ = 774 [mm]; attribute upperZ = 783 [mm];
                attribute lowerWidth = 16 [mm]; attribute upperWidth = 14 [mm]; attribute y = -906 [mm];
            }
            item grip {
                attribute x = -24 [mm]; attribute lowerZ = 770 [mm]; attribute upperZ = 786 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -907 [mm];
            }
            item fore {
                attribute x = 69 [mm]; attribute lowerZ = 775 [mm]; attribute upperZ = 783 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 12 [mm]; attribute y = -906 [mm];
            }
        }

        item rearHandleRight {
            attribute shape : String = "loft"; attribute color : String = "#41464B";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -919 [mm]; attribute lowerZ = 800 [mm]; attribute upperZ = 809 [mm];
                attribute lowerWidth = 16 [mm]; attribute upperWidth = 14 [mm]; attribute y = -906 [mm];
            }
            item grip {
                attribute x = -890 [mm]; attribute lowerZ = 796 [mm]; attribute upperZ = 812 [mm];
                attribute lowerWidth = 18 [mm]; attribute upperWidth = 15 [mm]; attribute y = -907 [mm];
            }
            item fore {
                attribute x = -797 [mm]; attribute lowerZ = 801 [mm]; attribute upperZ = 809 [mm];
                attribute lowerWidth = 14 [mm]; attribute upperWidth = 12 [mm]; attribute y = -906 [mm];
            }
        }

        item windshield {
            attribute shape : String = "loft"; attribute color : String = "#526471";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 1364 [mm]; attribute upperZ = 1366.4 [mm];
                attribute lowerWidth = 1136 [mm]; attribute upperWidth = 1134 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 1203 [mm]; attribute upperZ = 1205.4 [mm];
                attribute lowerWidth = 1186 [mm]; attribute upperWidth = 1184 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 991 [mm]; attribute upperZ = 993.4 [mm];
                attribute lowerWidth = 1316 [mm]; attribute upperWidth = 1314 [mm];
            }
            item windshieldFoot {
                attribute x = 1036 [mm]; attribute lowerZ = 865 [mm]; attribute upperZ = 867.4 [mm];
                attribute lowerWidth = 1456 [mm]; attribute upperWidth = 1454 [mm];
            }
        }

        item backlightGlass {
            attribute shape : String = "loft"; attribute color : String = "#485864";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 947 [mm]; attribute upperZ = 949.4 [mm];
                attribute lowerWidth = 1366 [mm]; attribute upperWidth = 1364 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 1077 [mm]; attribute upperZ = 1079.4 [mm];
                attribute lowerWidth = 1266 [mm]; attribute upperWidth = 1264 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 1233 [mm]; attribute upperZ = 1235.4 [mm];
                attribute lowerWidth = 1196 [mm]; attribute upperWidth = 1194 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 1357 [mm]; attribute upperZ = 1359.4 [mm];
                attribute lowerWidth = 1146 [mm]; attribute upperWidth = 1144 [mm];
            }
        }

        item hoodBadge {
            attribute shape : String = "loft"; attribute color : String = "#D2D5D6";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item crossbar {
                attribute x = 2122 [mm]; attribute lowerZ = 644.5 [mm]; attribute upperZ = 651.5 [mm];
                attribute lowerWidth = 58 [mm]; attribute upperWidth = 63 [mm];
            }
            item bridge {
                attribute x = 2131 [mm]; attribute lowerZ = 641 [mm]; attribute upperZ = 647 [mm];
                attribute lowerWidth = 51 [mm]; attribute upperWidth = 45 [mm];
            }
            item stem {
                attribute x = 2133 [mm]; attribute lowerZ = 640.5 [mm]; attribute upperZ = 646 [mm];
                attribute lowerWidth = 15 [mm]; attribute upperWidth = 13 [mm];
            }
            item tip {
                attribute x = 2162 [mm]; attribute lowerZ = 631.5 [mm]; attribute upperZ = 635 [mm];
                attribute lowerWidth = 3 [mm]; attribute upperWidth = 3 [mm];
            }
        }

        item windowSillLeft {
            attribute shape : String = "loft"; attribute color : String = "#222B31";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 919 [mm]; attribute upperZ = 929 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 727 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 925 [mm]; attribute upperZ = 935 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 762 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 928 [mm]; attribute upperZ = 938 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 785 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 923 [mm]; attribute upperZ = 933 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 797 [mm];
            }
            item roofArc {
                attribute x = -470 [mm]; attribute lowerZ = 918 [mm]; attribute upperZ = 928 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 805 [mm];
            }
            item roofCrown {
                attribute x = -180 [mm]; attribute lowerZ = 912 [mm]; attribute upperZ = 922 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 808 [mm];
            }
            item roofFront {
                attribute x = 80 [mm]; attribute lowerZ = 904 [mm]; attribute upperZ = 914 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 807 [mm];
            }
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 892 [mm]; attribute upperZ = 902 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 804 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 881 [mm]; attribute upperZ = 891 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 797 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 860 [mm]; attribute upperZ = 870 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = 777 [mm];
            }
        }

        item rockerMouldingLeft {
            attribute shape : String = "loft"; attribute color : String = "#65202A";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -1020 [mm]; attribute lowerZ = 187 [mm]; attribute upperZ = 200 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = 857 [mm];
            }
            item center {
                attribute x = -60 [mm]; attribute lowerZ = 170 [mm]; attribute upperZ = 193 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = 853 [mm];
            }
            item fore {
                attribute x = 1108 [mm]; attribute lowerZ = 184 [mm]; attribute upperZ = 201 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = 859 [mm];
            }
        }

        item windowSillRight {
            attribute shape : String = "loft"; attribute color : String = "#222B31";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item rearGlassFoot {
                attribute x = -1735 [mm]; attribute lowerZ = 919 [mm]; attribute upperZ = 929 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -727 [mm];
            }
            item backlight {
                attribute x = -1470 [mm]; attribute lowerZ = 925 [mm]; attribute upperZ = 935 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -762 [mm];
            }
            item rearGlass {
                attribute x = -1140 [mm]; attribute lowerZ = 928 [mm]; attribute upperZ = 938 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -785 [mm];
            }
            item rearRoof {
                attribute x = -805 [mm]; attribute lowerZ = 923 [mm]; attribute upperZ = 933 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -797 [mm];
            }
            item roofArc {
                attribute x = -470 [mm]; attribute lowerZ = 918 [mm]; attribute upperZ = 928 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -805 [mm];
            }
            item roofCrown {
                attribute x = -180 [mm]; attribute lowerZ = 912 [mm]; attribute upperZ = 922 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -808 [mm];
            }
            item roofFront {
                attribute x = 80 [mm]; attribute lowerZ = 904 [mm]; attribute upperZ = 914 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -807 [mm];
            }
            item windshieldHeader {
                attribute x = 355 [mm]; attribute lowerZ = 892 [mm]; attribute upperZ = 902 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -804 [mm];
            }
            item windshieldMiddle {
                attribute x = 630 [mm]; attribute lowerZ = 881 [mm]; attribute upperZ = 891 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -797 [mm];
            }
            item windshieldLower {
                attribute x = 910 [mm]; attribute lowerZ = 860 [mm]; attribute upperZ = 870 [mm];
                attribute lowerWidth = 12 [mm]; attribute upperWidth = 11 [mm]; attribute y = -777 [mm];
            }
        }

        item rockerMouldingRight {
            attribute shape : String = "loft"; attribute color : String = "#65202A";
            attribute centerX = 0 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 0 [mm];
            item aft {
                attribute x = -1020 [mm]; attribute lowerZ = 187 [mm]; attribute upperZ = 200 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = -857 [mm];
            }
            item center {
                attribute x = -60 [mm]; attribute lowerZ = 170 [mm]; attribute upperZ = 193 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = -853 [mm];
            }
            item fore {
                attribute x = 1108 [mm]; attribute lowerZ = 184 [mm]; attribute upperZ = 201 [mm];
                attribute lowerWidth = 10 [mm]; attribute upperWidth = 14 [mm]; attribute y = -859 [mm];
            }
        }

        item frontLeftTyre : RoadTyre {
            attribute centerX = 1492 [mm]; attribute centerY = 792 [mm]; attribute centerZ = 334.35 [mm];
        }

        part frontLeftCover : WheelCover {
            attribute centerX = 1492 [mm]; attribute centerY = 911 [mm]; attribute centerZ = 334.35 [mm];
        }

        item frontRightTyre : RoadTyre {
            attribute centerX = 1492 [mm]; attribute centerY = -792 [mm]; attribute centerZ = 334.35 [mm];
        }

        part frontRightCover : WheelCover {
            attribute centerX = 1492 [mm]; attribute centerY = -911 [mm]; attribute centerZ = 334.35 [mm];
        }

        item rearLeftTyre : RoadTyre {
            attribute centerX = -1383 [mm]; attribute centerY = 792 [mm]; attribute centerZ = 334.35 [mm];
        }

        part rearLeftCover : WheelCover {
            attribute centerX = -1383 [mm]; attribute centerY = 911 [mm]; attribute centerZ = 334.35 [mm];
        }

        item rearRightTyre : RoadTyre {
            attribute centerX = -1383 [mm]; attribute centerY = -792 [mm]; attribute centerZ = 334.35 [mm];
        }

        part rearRightCover : WheelCover {
            attribute centerX = -1383 [mm]; attribute centerY = -911 [mm]; attribute centerZ = 334.35 [mm];
        }

        part battery : BatteryPack {
            attribute centerX = -200 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 70 [mm];
        }

        part inverter : Inverter {
            attribute centerX = 500 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 175 [mm];
        }

        part motor : DriveMotor {
            attribute centerX = 1200 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 250 [mm];
        }

        connection batteryToInverter connect battery.output to inverter.input;
        connection inverterToMotor connect inverter.output to motor.input;
        flow power from battery.output to inverter.input;
        flow torque from inverter.output to motor.input;

    }

}
