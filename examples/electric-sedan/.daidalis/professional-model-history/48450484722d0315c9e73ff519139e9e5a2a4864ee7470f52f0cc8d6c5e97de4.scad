// ElectricSedan concept geometry. Units: mm; +X front; +Z up; ground z=0.
$fn=48;
module box(p,s,c){color(c) translate(p) cube(s,center=true);}
module cyl(p,r,h,c){color(c) translate(p) rotate([90,0,0]) cylinder(r=r,h=h,center=true);}
box([0,550,330],[2680,300,45],"SlateGray");
box([0,-550,330],[2680,300,45],"SlateGray");
box([-100,0,230],[2150,1240,125],"Goldenrod");
box([1480,0,650],[380,460,150],"CadetBlue");
cyl([1420,0,420],155,520,"Peru");
box([1170,0,245],[260,1150,65],"SlateGray");
box([-1350,0,245],[240,1150,65],"SlateGray");
module corner(x,y){
 cyl([x,y,325],325,215,"#20252B");
 cyl([x,y+sign(y)*115,325],215,12,"#B9C6D0");
 cyl([x,sign(y)*470,360],24,360,"#B9C6D0");
 box([x,sign(y)*540,210],[280,260,35],"SlateGray");
 color("#B9C6D0") translate([x,sign(y)*650,540]) cylinder(r=38,h=330,center=true);
 color("Goldenrod") translate([x,sign(y)*650,570]) difference(){cylinder(r=62,h=170,center=true); cylinder(r=45,h=172,center=true);}
}
corner(1350,780);
