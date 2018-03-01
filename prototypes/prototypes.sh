# Get prototypes from the webservice

for net in IB NR UP CR IU GO II NS SL OE GB AI LX AB NO HF TU CA BN YF IP VI BE ES LC WC EB DZ SS SL NL NA Z3; do
  curl "http://www.orfeus-eu.org/fdsnws/station/1/query?net=$net&level=network" > $net.xml
  seiscomp exec import_inv fdsnxml $net.xml $net.sc3ml
done

rm *.xml
