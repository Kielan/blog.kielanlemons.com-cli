
const path = require(`path`)
const resolveCwd = require(`resolve-cwd`)
const yargs = require(`yargs`)
const report = require(`./reporter`)
const didYouMean = require(`./did-you-mean`)
const envinfo = require(`envinfo`)
const existsSync = require(`fs-exists-cached`).sync
const contentfulManagement = require('contentful-management')

const {
trackCli,
setDefaultTags,
setTelemetryEnabled,
} = require(`gatsby-telemetry`)

const handlerP = fn => (...args) => {
  Promise.resolve(fn(...args)).then(
    () => process.exit(0),
    err => report.panic(err)
  )
}

function buildLocalCommands(cli, isLocalSite) {
  const defaultHost = `localhost`
  const directory = path.resolve(`.`)

  // 'not dead' query not available in browserslist used in Gatsby v1
  const DEFAULT_BROWSERS =
    installedGatsbyVersion() === 1
      ? [`> 1%`, `last 2 versions`, `IE >= 9`]
      : [`>0.25%`, `not dead`]

  let siteInfo = { directory, browserslist: DEFAULT_BROWSERS }
  const useYarn = existsSync(path.join(directory, `yarn.lock`))

  function installedGatsbyVersion() {
    let majorVersion
    try {
      const packageInfo = require(path.join(
        process.cwd(),
        `node_modules`,
        `gatsby`,
        `package.json`
      ))
      try {
        setDefaultTags({ installedGatsbyVersion: packageInfo.version })
      } catch (e) {
        // ignore
      }
      majorVersion = parseInt(packageInfo.version.split(`.`)[0], 10)
    } catch (err) {
      /* ignore */
    }

    return majorVersion
  }

  function resolveLocalCommand(command) {
    if (!isLocalSite) {
      cli.showHelp()
      report.verbose(`current directory: ${directory}`)
      return report.panic(
        `gatsby <${command}> can only be run for a gatsby site. \n` +
          `Either the current working directory does not contain a valid package.json or ` +
          `'gatsby' is not specified as a dependency`
      )
    }

    try {
      const cmdPath =
        resolveCwd.silent(`gatsby/dist/commands/${command}`) ||
        // Old location of commands
        resolveCwd.silent(`gatsby/dist/utils/${command}`)
      if (!cmdPath)
        return report.panic(
          `There was a problem loading the local ${command} command. Gatsby may not be installed in your site's "node_modules" directory. Perhaps you need to run "npm install"? You might need to delete your "package-lock.json" as well.`
        )

      report.verbose(`loading local command from: ${cmdPath}`)
      return require(cmdPath)
    } catch (err) {
      cli.showHelp()
      return report.panic(
        `There was a problem loading the local ${command} command. Gatsby may not be installed. Perhaps you need to run "npm install"?`,
        err
      )
    }
  }

  function getCommandHandler(command, handler) {
      return argv => {
        report.setVerbose(!!argv.verbose)
        if (argv.noColor) {
          // disables colors in popular terminal output coloring packages
          //  - chalk: see https://www.npmjs.com/package/chalk#chalksupportscolor
          //  - ansi-colors: see https://github.com/doowb/ansi-colors/blob/8024126c7115a0efb25a9a0e87bc5e29fd66831f/index.js#L5-L7
          process.env.FORCE_COLOR = `0`
        }

        report.setNoColor(!!argv.noColor)

        process.env.gatsby_log_level = argv.verbose ? `verbose` : `normal`
        report.verbose(`set gatsby_log_level: "${process.env.gatsby_log_level}"`)

        process.env.gatsby_executing_command = command
        report.verbose(`set gatsby_executing_command: "${command}"`)

        let localCmd = resolveLocalCommand(command)
        let args = { ...argv, ...siteInfo, report, useYarn }

        report.verbose(`running command: ${command}`)
        return handler ? handler(args, localCmd) : localCmd(args)
      }
    }

    cli.command({
      command: `omitAndDelete`,
      desc: `omit and delete field from contentful. particularly useful if you have deleted via ui but forgot to omit the field`,
      builder: _ =>
      _.option(`H`, {
        alias: `host`,
        type: `string`,
        default: defaultHost,
        describe: `Set host. Defaults to ${defaultHost}`,
      }),
      handler: args => {
        let omitandDeleteData
        try {
          omitandDeleteData = contentfulManagement.omitAndDeleteField('496f4006fbc32098e3aa71b3dd295c98')
        } catch (err) {
          console.log(`Error: unable to print environment info`)
          console.log(err)
        }
      },
    })
}

function isLocalGatsbySite() {
  let inGatsbySite = false
  try {
    let { dependencies, devDependencies } = require(path.resolve(
      `./package.json`
    ))
    inGatsbySite =
      (dependencies && dependencies.gatsby) ||
      (devDependencies && devDependencies.gatsby)
  } catch (err) {
    /* ignore */
  }
  return inGatsbySite
}

module.exports = argv => {
  let cli = yargs()
  let isLocalSite = isLocalGatsbySite()

  cli
    .scriptName(`gatsbyContentCli`)
    .usage(`Usage: $0 <command> [options]`)
    .alias(`h`, `help`)
    .alias(`v`, `version`)
    .option(`verbose`, {
      default: false,
      type: `boolean`,
      describe: `Turn on verbose output`,
      global: true,
    })

  buildLocalCommands(cli, isLocalSite)

  try {
    const { version } = require(`../package.json`)
    setDefaultTags({ gatsbyCliVersion: version })
  } catch (e) {
    // ignore
  }

  trackCli(argv)

  return cli
    .command({
      command: `telemetry`,
      desc: `Enable or disable Gatsby anonymous analytics collection.`,
      builder: yargs =>
        yargs
          .option(`enable`, {
            type: `boolean`,
            description: `Enable telemetry (default)`,
          })
          .option(`disable`, {
            type: `boolean`,
            description: `Disable telemetry`,
          }),

      handler: handlerP(({ enable, disable }) => {
        const enabled = enable || !disable
        setTelemetryEnabled(enabled)
        report.log(`Telemetry collection ${enabled ? `enabled` : `disabled`}`)
      }),
    })
    .wrap(cli.terminalWidth())
    .demandCommand(1, `Pass --help to see all available commands and options.`)
    .strict()
    .fail((msg, err, yargs) => {
      const availableCommands = yargs.getCommands().map(commandDescription => {
        const [command] = commandDescription
        return command.split(` `)[0]
      })
      const arg = argv.slice(2)[0]
      const suggestion = arg ? didYouMean(arg, availableCommands) : ``

      cli.showHelp()
      report.log(suggestion)
      report.log(msg)
    })
    .parse(argv.slice(2))
}
