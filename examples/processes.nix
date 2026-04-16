{ ... }:
{
  processes = {
    my-api = {
      exec = ''
        cd api && yarn dev
      '';
      process-compose = {
        depends_on.postgres.condition = "process_healthy";
        readiness_probe = {
          http_get = {
            host = "localhost";
            port = 4000;
            path = "/health";
          };
          initial_delay_seconds = 1;
          period_seconds = 2;
          failure_threshold = 30;
        };
      };
    };

    my-front = {
      exec = ''
        cd front && yarn dev
      '';
    };
  };
}
