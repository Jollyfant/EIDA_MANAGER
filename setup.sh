password="password"
dbpath_mysql="${PWD}/data/mysql"
dbpath_mongo="${PWD}/data/mongo"

if [ -z "${PWD}" ]; then
  echo The current working directory env variable PWD is unset! Please confirm.
  exit 1
fi

echo Running set up script for EIDA Manager MySQL
id=`docker run -d --rm -e "MYSQL_ROOT_PASSWORD=${password}" -e "MYSQL_DATABASE=seiscomp3" -v ${dbpath_mysql}:/var/lib/mysql mariadb:latest`
echo Temporary MySQL container running on ${id}
echo Sleeping 60 seconds to wait for container
sleep 60
echo Adding SeisComP3 schema to MySQL container
cat schema/seiscomp3.sql | docker exec -i ${id} mysql -uroot -ppassword seiscomp3
echo Shutting down temporary container ${id}
docker stop ${id}

echo Running set up script for EIDA Manager MongoDB
id=`docker run -d --rm -e "MONGO_INITDB_ROOT_USERNAME=root" -e "MONGO_INITDB_ROOT_PASSWORD=password" -v ${dbpath_mongo}:/data/db mongo:latest`
echo Sleeping 60 seconds to wait for container
sleep 60
echo Stopping temporary MongoDB container
docker stop ${id}

