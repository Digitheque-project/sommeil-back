#!/usr/bin/env bash
# Parcours de vérification des endpoints alimentant les boutons d'action.
# Crée puis supprime ses propres données de test.
B=http://127.0.0.1:8888/sommeil/api
J='Content-Type: application/json'
pass=0; fail=0

call() { # call METHOD PATH [BODY]
  if [ -n "$3" ]; then
    curl -s -m 30 -X "$1" -H "$J" -d "$3" "$B$2" -w "\n%{http_code}"
  else
    curl -s -m 30 -X "$1" "$B$2" -w "\n%{http_code}"
  fi
}

check() { # check LABEL EXPECTED METHOD PATH [BODY]
  local out code body
  out=$(call "$3" "$4" "$5")
  code=$(echo "$out" | tail -1)
  body=$(echo "$out" | sed '$d')
  if [ "$code" = "$2" ]; then
    pass=$((pass+1)); printf '  OK   %-3s %-46s %s\n' "$code" "$1" "$(echo "$body" | head -c 70)"
  else
    fail=$((fail+1)); printf '  FAIL %-3s (attendu %s) %-32s %s\n' "$code" "$2" "$1" "$(echo "$body" | head -c 90)"
  fi
  LAST_BODY="$body"
}

id_of() { echo "$LAST_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'; }

echo "== Consultations =="
check "GET  /consultations"          200 GET  "/consultations"
check "GET  /consultations/waiting"  200 GET  "/consultations/waiting"
check "GET  /consultations/controls" 200 GET  "/consultations/controls"
check "POST /consultations"          201 POST "/consultations" \
  '{"consultationId":"SMOKE-1","date":"2026-08-14T00:00:00.000Z","heure":"09:00","motif":"Test fumee","statut":"EN_ATTENTE","typeVisite":"INITIALE","patientId":"SMOKE-PAT","patientNom":"Test","patientPrenom":"Fumee","medecinId":"SMOKE-MED"}'
CID=$(id_of)
echo "  -> consultation $CID"

check "GET  /consultations/:id"           200 GET   "/consultations/$CID"
check "PATCH .../arrival"                 200 PATCH "/consultations/$CID/arrival" '{"arriveeAccueil":true}'
check "POST .../traiter ouvrir"           201 POST  "/consultations/$CID/traiter" '{"action":"ouvrir"}'
check "POST .../traiter reporter"         201 POST  "/consultations/$CID/traiter" '{"action":"reporter","nouvelleDate":"2026-08-20","nouvelleHeure":"11:00"}'
check "POST .../traiter controle"         201 POST  "/consultations/$CID/traiter" '{"action":"controle","rdvMotif":"suivi"}'
check "POST .../traiter action inconnue"  400 POST  "/consultations/$CID/traiter" '{"action":"nimporte"}'
check "PATCH .../control-note"            200 PATCH "/consultations/$CID/control-note" '{"note":"note de controle"}'
check "POST .../observations"             201 POST  "/consultations/$CID/observations" '{"diagnostic":"AOS","notes":"Tension : 12/8"}'
check "GET  /consultations/patient/:id/history" 200 GET "/consultations/patient/SMOKE-PAT/history"

echo
echo "== Comptes rendus =="
check "POST /comptes-rendus"      201 POST "/comptes-rendus" "{\"consultationId\":\"$CID\",\"titre\":\"CR fumee\",\"contenu\":\"Contenu initial\",\"type\":\"MEDICAL\"}"
CR=$(id_of)
check "GET  /comptes-rendus"      200 GET  "/comptes-rendus"
check "GET  /comptes-rendus/:id"  200 GET  "/comptes-rendus/$CR"
check "PUT  /comptes-rendus/:id"  200 PUT  "/comptes-rendus/$CR" '{"contenu":"Contenu modifie"}'
check "GET  .../export"           200 GET  "/comptes-rendus/$CR/export"
check "POST .../validate"         201 POST "/comptes-rendus/$CR/validate" '{"validePar":"Dr Test"}'
check "PUT apres validation (409)" 409 PUT  "/comptes-rendus/$CR" '{"contenu":"interdit"}'
check "DELETE apres validation (409)" 409 DELETE "/comptes-rendus/$CR"

echo
echo "== Polysomnographie =="
check "GET  /prescriptions/polysomnographie" 200 GET "/prescriptions/polysomnographie"
PSGID=$(echo "$LAST_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "  -> prescription PSG $PSGID"
check "POST .../schedule"      201 POST "/prescriptions/polysomnographie/$PSGID/schedule" '{"rdvDate":"2026-08-20","rdvHeure":"20:00"}'
check "GET  /psg"              200 GET  "/psg"
PLAN=$(echo "$LAST_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "GET  /psg/:id"          200 GET  "/psg/$PLAN"
check "PUT  /psg/:id (salle)"  200 PUT  "/psg/$PLAN" '{"salle":"Salle B-04"}'
check "POST /psg/:id/start"    201 POST "/psg/$PLAN/start" '{"salle":"Salle B-04"}'
check "POST /psg/:id/start x2 (409)" 409 POST "/psg/$PLAN/start" '{}'
check "GET  /psg/:id/export"   200 GET  "/psg/$PLAN/export"
check "POST /psg/:id/stop"     201 POST "/psg/$PLAN/stop"
check "POST /psg/:id/stop x2 (409)" 409 POST "/psg/$PLAN/stop"

echo
echo "== Archives =="
check "POST /consultations/:id/archive" 201 POST "/consultations/$CID/archive"
check "POST /archives"        201 POST "/archives" "{\"type\":\"CONSULTATION\",\"referenceId\":\"$CID\",\"titre\":\"Dossier fumee\",\"description\":\"test\",\"donnees\":{\"k\":\"v\"},\"archivedBy\":\"Dr Test\"}"
AR=$(id_of)
check "GET  /archives"        200 GET  "/archives"
check "GET  /archives/:id"    200 GET  "/archives/$AR"
check "GET  /archives/export" 200 GET  "/archives/export"
check "GET  /archives/:id/export" 200 GET "/archives/$AR/export"
check "POST .../restore"      201 POST "/archives/$AR/restore" '{"restoredBy":"Dr Test"}'
check "POST .../restore x2 (409)" 409 POST "/archives/$AR/restore" '{}'

echo
echo "== Stats & services =="
check "GET /stats?periode=7j"    200 GET "/stats?periode=7j"
check "GET /stats?periode=annee" 200 GET "/stats?periode=annee"
check "GET /stats/export"        200 GET "/stats/export"
check "GET /services/hospitalisation" 200 GET "/services/hospitalisation"

echo
echo "== Nettoyage =="
check "DELETE /psg/:id"       200 DELETE "/psg/$PLAN"
check "DELETE /archives/:id"  200 DELETE "/archives/$AR"
check "DELETE /consultations/:id" 200 DELETE "/consultations/$CID"

echo
echo "RESULTAT : $pass reussite(s), $fail echec(s)"
