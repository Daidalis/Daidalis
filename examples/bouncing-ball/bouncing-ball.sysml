package BouncingBallDemo {
    private import ScalarValues::*;

    port def Contact;

    part def Ball {
        attribute h : Real;
        attribute v : Real;
        port h : Contact;
    }

    part def Ground {
        port contact : Contact;
    }

    part drop {
        part ball : Ball;
        part ground : Ground;
        connection impact connect ball.h to ground.contact;
    }
}
