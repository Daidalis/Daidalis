#!/usr/bin/env python3
"""Instrument only an explicitly marked isolated NOS3 copy; no third-party deps."""
import argparse
import os
import difflib
import hashlib
import json
from pathlib import Path

ROOT_ORIGINAL = Path(os.environ['MANTA_NOS3_SOURCE']).resolve() if os.environ.get('MANTA_NOS3_SOURCE') else None
HEADER = r'''#ifndef MANTA_ST_PROBE_H
#define MANTA_ST_PROBE_H
void MantaProbeSensor(const double raw[4], const double mount[4], const double di[4], unsigned valid);
void MantaProbeADCS(const double di[4], unsigned di_valid, const double ad[4], unsigned ad_valid, const double gnc[4], unsigned gnc_valid);
#endif
'''
SOURCE = r'''#include <stdio.h>
#include <stddef.h>
#include "generic_adcs_msg.h"
#include "generic_star_tracker_msg.h"
#include "manta_st_probe.h"
static unsigned long MantaSequence = 0;
static double MantaRaw[4], MantaMount[4];
static void MantaQ(const char *name, const double q[4]) {
    printf("\"%s\":[%.17g,%.17g,%.17g,%.17g]", name, q[0], q[1], q[2], q[3]);
}
void MantaProbeSensor(const double raw[4], const double mount[4], const double di[4], unsigned valid) {
    unsigned i;
    flockfile(stdout);
    if (MantaSequence == 0) {
        unsigned short MantaEndianWord = 1;
        printf("MANTA_TRACE {\"stage\":\"telemetry_layout\",\"byte_order\":\"%s\",\"packets\":[", *((unsigned char *)&MantaEndianWord) ? "little" : "big");
        printf("{\"mid\":2358,\"name\":\"startracker\",\"size\":%lu,\"q_offset\":%lu,\"valid_offset\":%lu},", (unsigned long)sizeof(GENERIC_STAR_TRACKER_Device_tlm_t), (unsigned long)offsetof(GENERIC_STAR_TRACKER_Device_tlm_t,Generic_star_tracker.Q0),(unsigned long)offsetof(GENERIC_STAR_TRACKER_Device_tlm_t,Generic_star_tracker.IsValid));
        printf("{\"mid\":2369,\"name\":\"di\",\"size\":%lu,\"q_offset\":%lu,\"mount_offset\":%lu,\"valid_offset\":%lu},", (unsigned long)sizeof(Generic_ADCS_DI_Tlm_t),(unsigned long)offsetof(Generic_ADCS_DI_Tlm_t,Payload.St.q),(unsigned long)offsetof(Generic_ADCS_DI_Tlm_t,Payload.St.qbs),(unsigned long)offsetof(Generic_ADCS_DI_Tlm_t,Payload.St.valid));
        printf("{\"mid\":2370,\"name\":\"ad\",\"size\":%lu,\"q_offset\":%lu,\"valid_offset\":%lu},",(unsigned long)sizeof(Generic_ADCS_AD_Tlm_t),(unsigned long)offsetof(Generic_ADCS_AD_Tlm_t,Payload.ST.qbn),(unsigned long)offsetof(Generic_ADCS_AD_Tlm_t,Payload.ST.Valid));
        printf("{\"mid\":2371,\"name\":\"gnc\",\"size\":%lu,\"q_offset\":%lu,\"valid_offset\":%lu}]}\n",(unsigned long)sizeof(Generic_ADCS_GNC_Tlm_t),(unsigned long)offsetof(Generic_ADCS_GNC_Tlm_t,Payload.qbn),(unsigned long)offsetof(Generic_ADCS_GNC_Tlm_t,Payload.qValid));
    }
    MantaSequence++;
    for (i=0;i<4;i++) { MantaRaw[i]=raw[i]; MantaMount[i]=mount[i]; }
    printf("MANTA_TRACE {\"stage\":\"sb_ingest\",\"sensor_sequence\":%lu,\"valid\":%u,", MantaSequence, valid);
    MantaQ("raw_qsn",raw); printf(","); MantaQ("mount_qbs",mount); printf(","); MantaQ("di_q",di);
    printf("}\n"); fflush(stdout); funlockfile(stdout);
}
void MantaProbeADCS(const double di[4], unsigned di_valid, const double ad[4], unsigned ad_valid, const double gnc[4], unsigned gnc_valid) {
    flockfile(stdout);
    printf("MANTA_TRACE {\"stage\":\"adcs_update\",\"sensor_sequence\":%lu,\"di_valid\":%u,\"ad_valid\":%u,\"gnc_valid\":%u,", MantaSequence, di_valid, ad_valid, gnc_valid);
    MantaQ("raw_qsn",MantaRaw); printf(","); MantaQ("mount_qbs",MantaMount); printf(","); MantaQ("di_q",di); printf(","); MantaQ("ad_qbn",ad); printf(","); MantaQ("gnc_qbn",gnc);
    printf("}\n"); fflush(stdout); funlockfile(stdout);
}
'''
PROVIDER = r'''
        /* Manta integration observation only: actual provider and UART words. */
        std::printf("MANTA_TRACE {\"stage\":\"uart_simulator\",\"sensor_sign\":%d,\"sensor_bias_deg\":%.17g,\"source_qsn\":[%.17g,%.17g,%.17g,%.17g],\"provider_qsn\":[%.17g,%.17g,%.17g,%.17g],\"words\":[%u,%u,%u,%u],\"valid\":%u}\n", MantaSensorSign,MantaSensorBiasDeg,MantaSource[0],MantaSource[1],MantaSource[2],MantaSource[3],dq0,dq1,dq2,dq3,(unsigned)q0,(unsigned)q1,(unsigned)q2,(unsigned)q3,(unsigned)out_data[10]);
        std::fflush(stdout);
'''

def replace_once(text, before, after, path):
    if text.count(before) != 1:
        raise SystemExit(f'Expected exactly one source anchor in {path}: {before[:80]!r}')
    return text.replace(before, after, 1)

def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--mode', required=True, choices=['baseline', 'fixed'])
    p.add_argument('--sensor-sign', choices=['normal','negate'], default='normal',
                   help='Explicit physically equivalent quaternion sign injection, before real UART encoding')
    p.add_argument('--sensor-bias-deg',type=float,default=0.,
                   help='Explicit sensor-frame X rotation fault before real UART encoding; does not change 42 truth')
    args = p.parse_args()
    if not -5. <= args.sensor_bias_deg <= 5.:
        raise SystemExit('Sensor bias must remain within bounded +/-5 degrees')
    pins = json.loads((Path(__file__).resolve().parent/'pinned-source-hashes.json').read_text())['nos3']
    root = args.source.resolve()
    if ROOT_ORIGINAL is not None and (root == ROOT_ORIGINAL or ROOT_ORIGINAL in root.parents):
        raise SystemExit('Refusing to change the user original NOS3 checkout.')
    if not (root / '.manta-isolated-nos3').is_file():
        raise SystemExit('Missing explicit .manta-isolated-nos3 marker in isolated copy.')
    paths = {
        'ingest':'components/generic_adcs/fsw/cfs/src/generic_adcs_ingest.c',
        'adac':'components/generic_adcs/fsw/shared/generic_adcs_adac.c',
        'app':'components/generic_adcs/fsw/cfs/src/generic_adcs_app.c',
        'sim':'components/generic_star_tracker/sim/src/generic_star_tracker_hardware_model.cpp',
    }
    records = []
    patch = []
    prepared = []
    for key, rel in paths.items():
        path = root / rel
        backup = path.with_name(path.name + '.manta-original')
        old = (backup if backup.exists() else path).read_text()
        if sha(old) != pins.get(rel):
            raise SystemExit(f'Pinned original source hash mismatch: {rel}; refusing changed baseline')
        new = old
        if key == 'ingest':
            new = replace_once(new, '#include <stdio.h>', '#include <stdio.h>\n#include "manta_st_probe.h"', rel)
            operation = 'QxQ(q, St->qbs, St->q);'
            if args.mode == 'fixed':
                operation = '/* Keep raw q_SN; mounting is applied exactly once in AD_st. */\n    for (int i = 0; i < 4; ++i) St->q[i] = q[i];'
            new = replace_once(new, 'QxQ(q, St->qbs, St->q);', operation + '\n    MantaProbeSensor(q, St->qbs, St->q, St->valid);', rel)
        elif key == 'adac' and args.mode == 'fixed':
            new = replace_once(new, 'QxQ(DI_ST->q, DI_ST->qbs, qST);', '/* C_BN = C_BS C_SN, vector-first/scalar-last passive convention. */\n        QxQ(DI_ST->qbs, DI_ST->q, qST);', rel)
        elif key == 'app':
            new = replace_once(new, '#include "generic_adcs_perfids.h"', '#include "generic_adcs_perfids.h"\n#include "manta_st_probe.h"', rel)
            anchor = '            Generic_ADCS_output_to_actuators(&Generic_ADCS_AppData.GNCPacket.Payload,'
            probe = '''            MantaProbeADCS(Generic_ADCS_AppData.DIPacket.Payload.St.q,
                           Generic_ADCS_AppData.DIPacket.Payload.St.valid,
                           Generic_ADCS_AppData.ADPacket.Payload.ST.qbn,
                           Generic_ADCS_AppData.ADPacket.Payload.ST.Valid,
                           Generic_ADCS_AppData.GNCPacket.Payload.qbn,
                           Generic_ADCS_AppData.GNCPacket.Payload.qValid);
'''
            new = replace_once(new, anchor, probe + anchor, rel)
        elif key == 'sim':
            new = '#include <cstdio>\n#include <cmath>\n' + new
            anchor = '        double dq3 = data_point->get_generic_star_tracker_data_q3();'
            sign = -1 if args.sensor_sign == 'negate' else 1
            fault = f'''\n        const int MantaSensorSign = {sign};
        const double MantaSensorBiasDeg = {args.sensor_bias_deg:.17g};
        const double MantaSource[4] = {{dq0,dq1,dq2,dq3}};
        const double MantaHalfBias = MantaSensorBiasDeg * 3.14159265358979323846 / 360.0;
        const double MantaC = std::cos(MantaHalfBias), MantaS = std::sin(MantaHalfBias);
        /* Explicit measurement fault injection, never replacing the 42 body truth. */
        dq0 = MantaSensorSign * (MantaC*MantaSource[0] + MantaS*MantaSource[3]);
        dq1 = MantaSensorSign * (MantaC*MantaSource[1] + MantaS*MantaSource[2]);
        dq2 = MantaSensorSign * (MantaC*MantaSource[2] - MantaS*MantaSource[1]);
        dq3 = MantaSensorSign * (MantaC*MantaSource[3] - MantaS*MantaSource[0]);'''
            new = replace_once(new, anchor, anchor + fault, rel)
            anchor = '        out_data[12] = 0xEF;'
            # HK also has a trailer, but its index is 7; this anchor identifies data.
            new = replace_once(new, anchor, anchor + '\n' + PROVIDER, rel)
        prepared.append((path, backup, old, new))
        records.append({'path':rel,'original_sha256':sha(old),'instrumented_sha256':sha(new)})
        patch.extend(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='a/'+rel, tofile='b/'+rel))
    # Validate all anchors before writing anything.
    for path, backup, old, new in prepared:
        if not backup.exists():
            backup.write_text(old)
        path.write_text(new)
    src = root / 'components/generic_adcs/fsw/cfs/src'
    (src/'manta_st_probe.h').write_text(HEADER)
    (src/'manta_st_probe.c').write_text(SOURCE)
    manifest = {'kind':'production-path-integration-instrumentation','mode':args.mode,'sensor_sign':args.sensor_sign,
                'sensor_bias_deg':args.sensor_bias_deg,'files':records,
                'source':'https://github.com/nasa/nos3/issues/351',
                'notes':['Original source backup is retained in isolated copy.','Body truth is never substituted for sensor input.','Probe-only baseline preserves original algorithm.']}
    (root/f'manta-startracker-{args.mode}.patch').write_text(''.join(patch))
    (root/f'manta-startracker-{args.mode}.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'mode':args.mode,'source':str(root),'files':len(prepared),'manifest':str(root/f'manta-startracker-{args.mode}.json')}))

if __name__ == '__main__':
    main()
