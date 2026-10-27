/* Manta verification harness: executes upstream NOS3 ADCS primitives.
 * Independent oracle: passive Rodrigues rotation matrices, not simulator truth.
 * This does NOT execute the 42 telemetry transport, star tracker, or cFS task. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include "generic_adcs_utilities.h"
static void axisq(int axis,double angle,double q[4]) {for(int i=0;i<4;i++)q[i]=0;q[axis]=sin(angle/2);q[3]=cos(angle/2);}
static void axis_matrix(int axis,double angle,double c[3][3]) {
  double u[3]={0,0,0};u[axis]=1;double s=sin(angle),co=cos(angle);
  double k[3][3]={{0,-u[2],u[1]},{u[2],0,-u[0]},{-u[1],u[0],0}};
  for(int i=0;i<3;i++)for(int j=0;j<3;j++)c[i][j]=co*(i==j)+(1-co)*u[i]*u[j]-s*k[i][j];
}
static double error(const double a[3],const double b[3]) {double e=0;for(int i=0;i<3;i++)e=fmax(e,fabs(a[i]-b[i]));return e;}
int main(void) {
  const double angles[]={0,0.15,0.73,-1.21,2.1,3.141592653589793};
  const double v[3]={0.37,-0.51,0.79};double max_comp=0,max_sign=0,max_inv=0;int count=0;
  for(int ax=0;ax<3;ax++)for(int bx=0;bx<3;bx++)for(int ia=0;ia<6;ia++)for(int ib=0;ib<6;ib++) {
    double a[4],b[4],q[4],negative[4],out[3],negout[3],recovered[3],va[3],expect[3],ma[3][3],mb[3][3];
    axisq(ax,angles[ia],a);axisq(bx,angles[ib],b);axis_matrix(ax,angles[ia],ma);axis_matrix(bx,angles[ib],mb);
    for(int i=0;i<3;i++){va[i]=0;for(int j=0;j<3;j++)va[i]+=mb[i][j]*v[j];}
    for(int i=0;i<3;i++){expect[i]=0;for(int j=0;j<3;j++)expect[i]+=ma[i][j]*va[j];}
    QxQ(a,b,q);QxV(q,v,out);for(int i=0;i<4;i++)negative[i]=-q[i];QxV(negative,v,negout);QTxV(q,out,recovered);
    max_comp=fmax(max_comp,error(out,expect));max_sign=fmax(max_sign,error(out,negout));max_inv=fmax(max_inv,error(recovered,v));count++;
  }
  printf("{\"schema\":\"manta-nos3-component-results-v1\",\"cases\":%d,\"tolerance\":1e-12,\"compositionMaxError\":%.17g,\"signMaxError\":%.17g,\"inverseMaxError\":%.17g,\"passed\":%s}\n",count,max_comp,max_sign,max_inv,(max_comp<1e-12&&max_sign<1e-12&&max_inv<1e-12)?"true":"false");
  return (max_comp<1e-12&&max_sign<1e-12&&max_inv<1e-12)?0:1;
}
