#!/usr/bin/env python3
"""Focused independent-oracle tests; these are not full NOS3 simulation evidence."""
import math
import unittest
import signal
from verify_startracker import dcm,mm,angle,q_angle,verify,transpose
from configure_startracker_case import euler_dcm,matrix_quaternion

class OracleTests(unittest.TestCase):
    def fixtures(self,legacy=False,negative=False,invalid=False):
        cbs=transpose(euler_dcm([23.,-31.,17.],213)); qbs=matrix_quaternion(cbs)
        cbn=euler_dcm([17.,-23.,31.],321)
        csn=mm(transpose(cbs),cbn); qsn=matrix_quaternion(csn)
        if negative: qsn=[-x for x in qsn]
        words=[int(x*32767+32768) for x in qsn]
        wire=[(x-32768)/32767 for x in words]
        correct=mm(cbs,dcm(wire)); wrong=mm(mm(dcm(wire),cbs),cbs)
        output=matrix_quaternion(wrong if legacy else correct)
        validity=0 if invalid else 1
        sim=[{'stage':'uart_simulator','provider_qsn':qsn,'words':words,'valid':validity}]
        fsw=[{'stage':'sb_ingest','sensor_sequence':1,'raw_qsn':wire,'mount_qbs':qbs,'di_q':wire,'valid':validity},
             {'stage':'adcs_update','sensor_sequence':1,'raw_qsn':wire,'mount_qbs':qbs,'di_q':wire,
              'di_valid':validity,'ad_valid':validity,'gnc_valid':validity,'ad_qbn':output,'gnc_qbn':output}]
        return sim,fsw
    def test_passive_rotation_basis(self):
        q=[0.,0.,math.sqrt(.5),math.sqrt(.5)]
        self.assertLess(abs(dcm(q)[0][1]-1),1e-14)
        self.assertLess(abs(dcm(q)[1][0]+1),1e-14)
    def test_sign_invariance(self):
        self.assertLess(q_angle([.1,.2,.3,.9],[-.1,-.2,-.3,-.9]),1e-5)
    def test_noncommuting_frame_chain_passes(self):
        sim,fsw=self.fixtures(); self.assertTrue(verify(sim,fsw,min_samples=1)['passed'])
    def test_legacy_double_mount_is_detected(self):
        sim,fsw=self.fixtures(legacy=True); result=verify(sim,fsw,min_samples=1)
        self.assertFalse(result['passed'])
        errors=[x for x in result['checks'] if x['name']=='sensor_to_body_rotation_applied_once_in_correct_order']
        self.assertGreater(errors[0]['max_rotation_error_deg'],10.)
    def test_negated_live_source_representation(self):
        sim,fsw=self.fixtures(negative=True); self.assertTrue(verify(sim,fsw,min_samples=1)['passed'])
    def test_invalid_sensor_flag_propagates(self):
        sim,fsw=self.fixtures(invalid=True)
        self.assertTrue(verify(sim,fsw,min_samples=1,expect_invalid=True)['passed'])
        fsw[-1]['gnc_valid']=1
        self.assertFalse(verify(sim,fsw,min_samples=1,expect_invalid=True)['passed'])
    def test_missing_production_observations_fail(self):
        self.assertFalse(verify([],[],min_samples=1)['passed'])
    def test_transport_mismatch_fails(self):
        sim,fsw=self.fixtures(); fsw[0]['raw_qsn'][0]+=.1
        self.assertFalse(verify(sim,fsw,min_samples=1)['passed'])
    def test_zero_and_nonfinite_quaternions_rejected(self):
        for q in [[0.,0.,0.,0.],[float('nan'),0.,0.,1.]]:
            with self.assertRaises(ValueError): dcm(q)
    def test_independent_euler_quaternion_roundtrip(self):
        for sequence in [123,213,321]:
            c=euler_dcm([12.,-31.,53.],sequence)
            self.assertLess(angle(c,dcm(matrix_quaternion(c))),1e-5)
    def test_campaign_termination_enters_python_cleanup_path(self):
        from verify_all import install_signal_handlers,CampaignInterrupted
        saved={sig:signal.getsignal(sig) for sig in [signal.SIGTERM,signal.SIGINT]}
        try:
            install_signal_handlers()
            for sig in saved:
                with self.assertRaises(CampaignInterrupted): signal.raise_signal(sig)
        finally:
            for sig,handler in saved.items(): signal.signal(sig,handler)

if __name__=='__main__': unittest.main()
