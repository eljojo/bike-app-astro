#!/usr/bin/env bash
# Re-encode existing videos by copying originals from the Rails bucket
# to the new bucket with 8-char keys. The S3 trigger fires the Lambda
# automatically for each copy.
#
# Usage:
#   bash scripts/reencode-videos.sh [--dry-run]   Copy originals to trigger re-encode
#   bash scripts/reencode-videos.sh --cleanup      Delete old AV1 files from outputs

set -euo pipefail

SRC_BUCKET="bike-app-video-originals"
DST_BUCKET="bike-video-originals"
OUT_BUCKET="bike-video-outputs"
PREFIX="ottawa"
DRY_RUN=false
CLEANUP=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN — no files will be copied"
elif [[ "${1:-}" == "--cleanup" ]]; then
  CLEANUP=true
fi

# new 8-char keys (from bike-routes commit 693987b)
NEW_KEYS=(
  ibg882fk dgvuni6d zrsge36g k1cwopi6 y2gw4cjd 565knbp2 yt9p0fov lh11cx8f
  tw3ba6pn lewwwrvp mqjt8fk8 g9ngr11w jmfk6p6g 2bxzhtja 4dfe005j qe19xw5o
  f9fhwrfh k3eovg6o 2uwjrs6s 5bke1jr2 a5j3mas6 9h0akgcm zir1aw24 yjozwat5
  syuduier 5m05pek8 68ep9lm9 3a4xslt5 99hldqd7 79q75q37 6ra6xjov 6179meq6
  drz6rzch kjveay4j
)

# --- Cleanup mode: delete AV1 files from outputs ---
if $CLEANUP; then
  echo "Cleaning up AV1 files from $OUT_BUCKET/$PREFIX/"
  echo ""
  deleted=0
  missing=0
  for key in "${NEW_KEYS[@]}"; do
    av1="s3://$OUT_BUCKET/$PREFIX/$key/$key-av1.mp4"
    echo -n "  $key-av1.mp4 ... "
    if aws s3 rm "$av1" --quiet 2>/dev/null; then
      echo "deleted"
      deleted=$((deleted + 1))
    else
      echo "not found"
      missing=$((missing + 1))
    fi
  done
  echo ""
  echo "Done: $deleted deleted, $missing not found"
  exit 0
fi

# --- Re-encode mode: copy originals to trigger Lambda ---

# old-blob-key → new-8char-key mappings
declare -A KEYS=(
  [oxk14xfu79tt3kpki495dv7gujbw]=ibg882fk
  [7tok3akxj9niqh2i8qze0k82y626]=dgvuni6d
  [4yxnwy5dj6bhrsjx8bgygyvqc2zh]=zrsge36g
  [7ygvm58bp84e1n6ucwe0fissc847]=k1cwopi6
  [8flt8mm82dw29tm9i6buzlc9u2hj]=y2gw4cjd
  [t1nx9u04j1o1dn2bq74lob9jxtoi]=565knbp2
  [120zwwbl0dvvrxzmnopb2lyky9fm]=yt9p0fov
  [wynjh1xghp2ydchwsglrt4zlehop]=lh11cx8f
  [71nx1hyq97av9jztsovr0s1grv26]=tw3ba6pn
  [9vf806pvogy5lap3eg56jyyjzylx]=lewwwrvp
  [w373sup33z36gjnjlbttcxkah2ph]=mqjt8fk8
  [k2ajpk9adtffziiypnc6ukfvr0sg]=g9ngr11w
  [emp15w7sy05w9e3p7cz060eb3vn4]=jmfk6p6g
  [bo95jxvzy9pb0szi1pwrca7upuue]=2bxzhtja
  [w8dkt171uqzw3rvflnvjs0oqw22g]=4dfe005j
  [82ln9wj8emrb4u1djrua57jrv5l5]=qe19xw5o
  [v2fuwf39f5kh65f0fpv512zyh8fd]=f9fhwrfh
  [1org4brid8t60s52ogajwhfrgvhx]=k3eovg6o
  [c79yu717in7661t4hv9bziqsk7oe]=2uwjrs6s
  [jk211jpksn51w4kxyruc9p149qr9]=5bke1jr2
  [c4ngztskp6xtaz3e0152ahd2c4ld]=a5j3mas6
  [61tnwaym3bll74bdzx0fib6mfj6y]=9h0akgcm
  [rc80pjjcu57l0hjhnzt3rfsq9edu]=zir1aw24
  [3mzaailb2vgq7wcpi2ri1zasjw6u]=yjozwat5
  [l8vdm16cmty4bt25gt4d51asm0xe]=syuduier
  [90110ukov6uqhuaef0yegomfi3om]=5m05pek8
  [drv07jw6v0mo8pfcyj7hravku4h2]=68ep9lm9
  [7p6sabrr2zpspe0sl2jgks3qozae]=3a4xslt5
  [87jj16e8gqosloiftm4jdd763d58]=99hldqd7
  [yn4xl2m0enx0bphxtntx1h1savwg]=79q75q37
  [cm6xxml84f9sibreqx1prn9ebbh6]=6ra6xjov
  [c8utp2tmfgs085wd5c6wm3ueoeqf]=6179meq6
  [vno0d04arlqe5suqm7dvrenab3ox]=drz6rzch
  [l7ntrna5qc0ytytz04j9yytx7jgc]=kjveay4j
)

echo "Re-encoding ${#KEYS[@]} videos: $SRC_BUCKET → $DST_BUCKET/$PREFIX/"
echo ""

copied=0
failed=0

for old in "${!KEYS[@]}"; do
  new="${KEYS[$old]}"
  echo -n "  $old → $PREFIX/$new ... "

  if $DRY_RUN; then
    echo "would copy"
    copied=$((copied + 1))
    continue
  fi

  if aws s3 cp "s3://$SRC_BUCKET/$old" "s3://$DST_BUCKET/$PREFIX/$new" --quiet 2>/dev/null; then
    echo "ok"
    copied=$((copied + 1))
  else
    echo "FAILED"
    failed=$((failed + 1))
  fi
done

echo ""
echo "Done: $copied copied, $failed failed"
echo ""
echo "Once MediaConvert finishes, clean up old AV1 files with:"
echo "  bash scripts/reencode-videos.sh --cleanup"
